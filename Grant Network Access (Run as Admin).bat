@echo off
echo This lets students on your WiFi reach this app from their own devices.
echo You only need to run this once (right-click this file, "Run as administrator").
netsh http add urlacl url=http://+:5174/ user=Everyone
netsh advfirewall firewall add rule name="HomeworkFocus" dir=in action=allow protocol=TCP localport=5174
echo Done. You can now use "Start HomeworkFocus.bat" normally (no admin needed).
pause
