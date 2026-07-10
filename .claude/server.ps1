param($Port = 5174, $DataFolder = "data")
$root = Split-Path -Parent $PSScriptRoot
$dataFile = Join-Path $root "$DataFolder\state.json"
$dataDir = Join-Path $root $DataFolder
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
if (-not (Test-Path $dataFile)) {
  $seed = @{
    pin = "1234"
    students = @{}
    messages = @()
    history = @()
    currentAssignmentId = "sample"
    assignments = @{
      sample = @{
        id = "sample"; type = "translation"; title = "Sample: Translate this paragraph"
        content = "The weather today is sunny with a light breeze. Many people are walking in the park, enjoying the fresh air and warm sunshine."
        targetMinutes = 15; requireMinTime = $false
      }
    }
  }
  ($seed | ConvertTo-Json -Depth 10) | Out-File -FilePath $dataFile -Encoding utf8
}

function Read-State {
  $state = Get-Content -Raw -Path $dataFile | ConvertFrom-Json
  if (-not $state.PSObject.Properties["pin"]) { $state | Add-Member -NotePropertyName pin -NotePropertyValue "1234" -Force }
  if (-not $state.PSObject.Properties["students"]) { $state | Add-Member -NotePropertyName students -NotePropertyValue (New-Object PSObject) -Force }
  if (-not $state.PSObject.Properties["messages"]) { $state | Add-Member -NotePropertyName messages -NotePropertyValue @() -Force }
  if (-not $state.PSObject.Properties["history"]) { $state | Add-Member -NotePropertyName history -NotePropertyValue @() -Force }
  if (-not $state.PSObject.Properties["assignments"]) {
    $state | Add-Member -NotePropertyName assignments -NotePropertyValue (New-Object PSObject) -Force
  }
  if (-not $state.PSObject.Properties["currentAssignmentId"]) { $state | Add-Member -NotePropertyName currentAssignmentId -NotePropertyValue "sample" -Force }
  foreach ($prop in $state.students.PSObject.Properties) {
    $s = $prop.Value
    if (-not $s.PSObject.Properties["readingAnswerText"]) {
      $legacy = if ($s.PSObject.Properties["answerText"]) { $s.answerText } else { "" }
      $s | Add-Member -NotePropertyName readingAnswerText -NotePropertyValue $legacy -Force
    }
    if (-not $s.PSObject.Properties["listeningAnswerText"]) { $s | Add-Member -NotePropertyName listeningAnswerText -NotePropertyValue "" -Force }
  }
  return $state
}
function Write-State($state) {
  ($state | ConvertTo-Json -Depth 10) | Out-File -FilePath $dataFile -Encoding utf8
}

function Get-EffectiveAssignment($state, $studentId) {
  $assignId = $state.currentAssignmentId
  if ($studentId -and $state.students.PSObject.Properties[$studentId]) {
    $s = $state.students.($studentId)
    if ($s.PSObject.Properties["assignmentId"] -and $s.assignmentId) { $assignId = $s.assignmentId }
  }
  if ($state.assignments.PSObject.Properties[$assignId]) {
    return $state.assignments.($assignId)
  }
  return $null
}

$listener = New-Object System.Net.HttpListener
try {
  $listener.Prefixes.Add("http://+:$Port/")
  $listener.Start()
  Write-Host "Serving $root on http://+:$Port/ (LAN-accessible)"
} catch {
  Write-Host "Could not bind to all interfaces (needs one-time network access grant). Falling back to localhost only."
  Write-Host "Run 'Grant Network Access (Run as Admin).bat' once, then restart this server."
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://localhost:$Port/")
  $listener.Start()
  Write-Host "Serving $root on http://localhost:$Port/"
}

$mime = @{
  ".html" = "text/html"; ".css" = "text/css"; ".js" = "application/javascript";
  ".json" = "application/json"; ".png" = "image/png"; ".jpg" = "image/jpeg";
  ".svg" = "image/svg+xml"; ".txt" = "text/plain"; ".mp3" = "audio/mpeg"
}

function Send-Json($res, $obj, $status = 200) {
  # Piping to ConvertTo-Json enumerates arrays, so a single-item array
  # collapses into a bare object instead of a JSON array. -InputObject avoids that.
  $json = ConvertTo-Json -InputObject $obj -Depth 10
  [byte[]]$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $status
  $res.ContentType = "application/json"
  $res.ContentLength64 = [int64]$bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.OutputStream.Flush()
}

function Read-Body($req) {
  # JSON is UTF-8 by spec, but fetch() doesn't send a charset param, so
  # $req.ContentEncoding falls back to a non-UTF-8 default and mangles
  # emoji/accented characters. Force UTF-8 explicitly instead.
  $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
  $body = $reader.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($body)) { return $null }
  return $body | ConvertFrom-Json
}

while ($listener.IsListening) {
  $context = $listener.GetContext()
  $req = $context.Request
  $res = $context.Response
  $path = $req.Url.LocalPath
  $res.Headers.Add("Access-Control-Allow-Origin", "*")
  $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
  $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

  try {
    if ($req.HttpMethod -eq "OPTIONS") {
      $res.StatusCode = 204
      $res.OutputStream.Close()
      continue
    }

    if ($path -eq "/api/state" -and $req.HttpMethod -eq "GET") {
      $state = Read-State
      Send-Json $res $state
    }
    elseif ($path -eq "/api/student" -and $req.HttpMethod -eq "GET") {
      $id = $req.QueryString["id"]
      $state = Read-State
      $studentsObj = $state.students
      if ($id -and $studentsObj -and $studentsObj.PSObject.Properties[$id]) {
        Send-Json $res $studentsObj.($id)
      } else {
        Send-Json $res $null 404
      }
    }
    elseif ($path -eq "/api/join" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      if ($body.pin -ne $state.pin) {
        Send-Json $res @{ error = "wrong-pin" } 401
      } else {
        $id = ($body.name -replace '[^a-zA-Z0-9]', '').ToLower() + "-" + (Get-Random -Maximum 9999)
        $studentsObj = $state.students
        if (-not $studentsObj) { $studentsObj = New-Object PSObject }
        $studentsObj | Add-Member -NotePropertyName $id -NotePropertyValue @{
          name = $body.name; activeMs = 0; assignmentId = $null; completed = $false
          lastSeen = (Get-Date).ToString("o"); joinedAt = (Get-Date).ToString("o")
          isActive = $false; paused = $false; resetToken = 0
          readingAnswerText = ""; listeningAnswerText = ""; hasPlayedAudio = $false; idleSince = $null
        } -Force
        $state.students = $studentsObj
        Write-State $state
        Send-Json $res @{ id = $id }
      }
    }
    elseif ($path -eq "/api/activity" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $studentsObj = $state.students
      if ($studentsObj.PSObject.Properties[$body.id]) {
        $s = $studentsObj.($body.id)
        $wasActive = $s.isActive
        $s.activeMs = $body.activeMs
        $s.isActive = $body.isActive
        $s.completed = $body.completed
        if ($body.PSObject.Properties["answerText"]) {
          if ($body.taskType -eq "listening") { $s.listeningAnswerText = $body.answerText }
          else { $s.readingAnswerText = $body.answerText }
        }
        if ($body.PSObject.Properties["hasPlayedAudio"]) { $s.hasPlayedAudio = $body.hasPlayedAudio }
        if ($wasActive -and -not $body.isActive) { $s.idleSince = (Get-Date).ToString("o") }
        elseif ($body.isActive) { $s.idleSince = $null }
        $s.lastSeen = (Get-Date).ToString("o")
        Write-State $state
      }
      Send-Json $res @{ ok = $true }
    }
    elseif ($path -eq "/api/assignment" -and $req.HttpMethod -eq "GET") {
      $studentId = $req.QueryString["id"]
      $state = Read-State
      $a = Get-EffectiveAssignment $state $studentId
      Send-Json $res $a
    }
    elseif ($path -eq "/api/assignments" -and $req.HttpMethod -eq "GET") {
      $state = Read-State
      Send-Json $res @{ assignments = $state.assignments; currentAssignmentId = $state.currentAssignmentId }
    }
    elseif ($path -eq "/api/assignments" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $id = $body.id
      if (-not $id) { $id = "a-" + (Get-Date).Ticks }
      $assignmentsObj = $state.assignments
      $assignmentsObj | Add-Member -NotePropertyName $id -NotePropertyValue @{
        id = $id; type = $body.type; title = $body.title; content = $body.content
        targetMinutes = $body.targetMinutes; requireMinTime = [bool]$body.requireMinTime
      } -Force
      $state.assignments = $assignmentsObj
      Write-State $state
      Send-Json $res @{ ok = $true; id = $id }
    }
    elseif ($path -eq "/api/set-default-assignment" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $state.currentAssignmentId = $body.id
      Write-State $state
      Send-Json $res @{ ok = $true }
    }
    elseif ($path -eq "/api/assign-student" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $studentsObj = $state.students
      if ($studentsObj.PSObject.Properties[$body.studentId]) {
        $studentsObj.($body.studentId).assignmentId = $body.assignmentId
        Write-State $state
        Send-Json $res @{ ok = $true }
      } else {
        Send-Json $res @{ error = "not-found" } 404
      }
    }
    elseif ($path -eq "/api/pin" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $state.pin = $body.pin
      Write-State $state
      Send-Json $res @{ ok = $true }
    }
    elseif ($path -eq "/api/clear-roster" -and $req.HttpMethod -eq "POST") {
      $state = Read-State
      $studentsObj = $state.students
      $historyList = @($state.history)
      $today = (Get-Date).ToString("yyyy-MM-dd")
      foreach ($prop in $studentsObj.PSObject.Properties) {
        $s = $prop.Value
        $assignment = Get-EffectiveAssignment $state $prop.Name
        $historyList += @{
          date = $today
          studentId = $prop.Name
          name = $s.name
          assignmentTitle = if ($assignment) { $assignment.title } else { "" }
          activeMs = $s.activeMs
          completed = $s.completed
          readingAnswerText = $s.readingAnswerText
          listeningAnswerText = $s.listeningAnswerText
        }
      }
      $state.history = $historyList
      $state.students = New-Object PSObject
      Write-State $state
      Send-Json $res @{ ok = $true }
    }
    elseif ($path -eq "/api/history" -and $req.HttpMethod -eq "GET") {
      $state = Read-State
      Send-Json $res @($state.history)
    }
    elseif ($path -eq "/api/control" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $studentsObj = $state.students
      if ($studentsObj.PSObject.Properties[$body.id]) {
        $s = $studentsObj.($body.id)
        if ($body.action -eq "pause") { $s.paused = $true }
        elseif ($body.action -eq "resume") { $s.paused = $false }
        elseif ($body.action -eq "reset") { $s.activeMs = 0; $s.resetToken = [int]$s.resetToken + 1 }
        Write-State $state
        Send-Json $res @{ ok = $true }
      } else {
        Send-Json $res @{ error = "not-found" } 404
      }
    }
    elseif ($path -eq "/api/messages" -and $req.HttpMethod -eq "GET") {
      $id = $req.QueryString["id"]
      $state = Read-State
      $all = @($state.messages)
      if ($id) {
        $filtered = $all | Where-Object { $_.studentId -eq $id -or $_.studentId -eq $null }
        Send-Json $res @($filtered)
      } else {
        Send-Json $res @($all)
      }
    }
    elseif ($path -eq "/api/messages" -and $req.HttpMethod -eq "POST") {
      $body = Read-Body $req
      $state = Read-State
      $msgs = @($state.messages)
      $msgs += @{
        id = "m-" + (Get-Date).Ticks
        studentId = $body.studentId
        from = $body.from
        fromName = $body.fromName
        text = $body.text
        ts = (Get-Date).ToString("o")
      }
      $state.messages = $msgs
      Write-State $state
      Send-Json $res @{ ok = $true }
    }
    else {
      if ($path -eq "/") { $path = "/index.html" }
      $filePath = Join-Path $root ($path.TrimStart("/"))
      $res.KeepAlive = $false
      if (Test-Path $filePath -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($filePath)
        $contentType = $mime[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }
        [byte[]]$bytes = [System.IO.File]::ReadAllBytes($filePath)
        $res.ContentType = $contentType
        $res.ContentLength64 = [int64]$bytes.Length
        if ($req.HttpMethod -ne "HEAD") {
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
          $res.OutputStream.Flush()
        }
      } else {
        [byte[]]$msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
        $res.StatusCode = 404
        $res.ContentLength64 = [int64]$msg.Length
        $res.OutputStream.Write($msg, 0, $msg.Length)
        $res.OutputStream.Flush()
      }
    }
  } catch {
    Write-Host "Request error: $_"
    try { $res.StatusCode = 500 } catch {}
  } finally {
    try { $res.OutputStream.Close() } catch {}
  }
}
