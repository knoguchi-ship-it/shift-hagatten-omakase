!macro customInit
  ; 既存インストールを検出し、再インストール（修復）かアンインストールを選ばせる。
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ${If} $0 == ""
    ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "UninstallString"
  ${EndIf}
  ${If} $0 != ""
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "シフトはがってんおまかせ！は既にインストールされています。$\r$\n$\r$\n［はい］修復（再インストール）$\r$\n［いいえ］アンインストール$\r$\n［キャンセル］何もしない" IDYES shiftc_repair IDNO shiftc_uninstall
    Abort
    shiftc_uninstall:
      ExecWait '$0 /S'
      Quit
    shiftc_repair:
      ; 通常のelectron-builder更新処理へ進み、旧版を置換する。
      Goto shiftc_done
    shiftc_done:
  ${EndIf}
!macroend
