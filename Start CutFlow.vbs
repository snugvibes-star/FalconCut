' CutFlow launcher — starts the local server and the app window with no
' console flashing. Used by the desktop and Start Menu shortcuts.
Dim sh, fso, root
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = root
sh.Run """" & root & "\Start CutFlow.bat""", 0, False
