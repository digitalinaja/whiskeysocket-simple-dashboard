$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\Whiskey Socket Dashboard.lnk")
$Shortcut.TargetPath = "C:\Users\MANAGER IT\Gitrepos\whiskeysocket-simple-dashboard\start-app.bat"
$Shortcut.WorkingDirectory = "C:\Users\MANAGER IT\Gitrepos\whiskeysocket-simple-dashboard"
$Shortcut.Description = "Launch Whiskey Socket Dashboard"
$Shortcut.Save()
