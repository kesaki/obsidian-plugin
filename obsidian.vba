Sub CheckIncompleteTasks()
    Dim filePath As String
    Dim stream As Object
    Dim fileContent As String
    Dim lines() As String
    Dim line As Variant
    Dim regEx As Object
    Dim incompleteCount As Long
    Dim warningMsg As String
    
    ' 指定されたファイルパスを設定
    filePath = "C:\Users\hk\Documents\ローカルドキュメント\無題のファイル 1.md"
    
    ' ADODB.StreamオブジェクトでUTF-8ファイルを開く
    Set stream = CreateObject("ADODB.Stream")
    With stream
        .Type = 2
        .Charset = "UTF-8"
        .Open
        .LoadFromFile filePath
        fileContent = .ReadText(-1)
        .Close
    End With
    
    ' 正規表現オブジェクトの作成（行頭の "- [ ]" を検出）
    Set regEx = CreateObject("VBScript.RegExp")
    regEx.Pattern = "^\s*- \[ \]"
    regEx.IgnoreCase = True
    regEx.Global = False
    
    ' 改行コードを統一して各行に分割
    fileContent = Replace(fileContent, vbCrLf, vbLf)
    fileContent = Replace(fileContent, vbCr, vbLf)
    lines = Split(fileContent, vbLf)
    
    incompleteCount = 0
    warningMsg = "以下の未完了タスクが見つかりました：" & vbCrLf & vbCrLf
    
    ' For Each で各行を走査（行番号なし）
    For Each line In lines
        If regEx.Test(line) Then
            incompleteCount = incompleteCount + 1
            If incompleteCount <= 20 Then
                warningMsg = warningMsg & "・ " & line & vbCrLf
            End If
        End If
    Next line
    
    ' 判定結果に応じた処理
    If incompleteCount > 0 Then
        If incompleteCount > 20 Then
            warningMsg = warningMsg & vbCrLf & "…ほか計 " & incompleteCount & " 件の未完了タスクがあります。"
        End If
        MsgBox warningMsg, vbExclamation, "未完了タスクの警告"
    Else
        MsgBox "未完了タスク（- [ ]）はありませんでした。", vbInformation, "確認完了"
    End If
    
    Set stream = Nothing
    Set regEx = Nothing
End Sub
