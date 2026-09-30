param([string]$ReleaseDir = (Join-Path $PSScriptRoot '../release'))
$ErrorActionPreference = 'Stop'
$publisher = 'Ricos Labs LLC'
$root = (Resolve-Path -LiteralPath $ReleaseDir).Path
$installers = @(Get-ChildItem -LiteralPath $root -Filter '*Setup*.exe' -File)
$portable = @(Get-ChildItem -LiteralPath $root -Filter '*.exe' -File | Where-Object Name -NotLike '*Setup*')
$app = Join-Path $root 'win-unpacked/Raptor Runner.exe'
if ($installers.Count -ne 1 -or $portable.Count -ne 1 -or !(Test-Path -LiteralPath $app)) {
    throw 'Expected one NSIS installer, one portable executable, and win-unpacked/Raptor Runner.exe.'
}
$files = @($installers) + @($portable) + @(Get-Item -LiteralPath $app)
$evidence = foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') { throw "Invalid signature: $($file.Name): $($signature.Status)" }
    $name = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($name -cne $publisher) { throw "Unexpected publisher on $($file.Name): $name" }
    if (!$signature.TimeStamperCertificate) { throw "Missing timestamp: $($file.Name)" }
    [ordered]@{
        file = [IO.Path]::GetRelativePath($root, $file.FullName)
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        status = "$($signature.Status)"
        publisher = $name
        subject = $signature.SignerCertificate.Subject
        thumbprint = $signature.SignerCertificate.Thumbprint
        timestampSubject = $signature.TimeStamperCertificate.Subject
        commit = $env:GITHUB_SHA
        runId = $env:GITHUB_RUN_ID
    }
}
$evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'signing-evidence.json')
$evidence | Format-Table file, status, publisher, sha256 -AutoSize
