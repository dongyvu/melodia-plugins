# 打包为 build/lastfm.melodiaplugin；zip 内路径必须用正斜杠，所以不用 Compress-Archive
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$files = @('plugin.json', 'main.js', 'ui/account.json')
$outDir = Join-Path $root 'build'
$out = Join-Path $outDir 'lastfm.melodiaplugin'

New-Item -ItemType Directory -Force $outDir | Out-Null
if (Test-Path $out) { Remove-Item $out -Force }

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($name in $files) {
        $source = Join-Path $root $name
        if (-not (Test-Path $source)) { throw "缺少文件 $name" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $source, $name, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally {
    $zip.Dispose()
}

$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
$size = (Get-Item $out).Length
Write-Output "$out"
Write-Output "sha256 $hash"
Write-Output "size $size"
