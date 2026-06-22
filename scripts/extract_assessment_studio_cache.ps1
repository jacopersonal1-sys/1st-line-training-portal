param(
    [string]$OutputRoot = "$env:USERPROFILE\Desktop",
    [switch]$IncludeRawCache = $true
)

$ErrorActionPreference = "SilentlyContinue"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $OutputRoot "AssessmentStudioCacheRecovery_$stamp"
$rawDir = Join-Path $outDir "raw_cache_files"
$candidateDir = Join-Path $outDir "candidates"
New-Item -ItemType Directory -Force $outDir, $rawDir, $candidateDir | Out-Null

$report = New-Object System.Collections.Generic.List[string]
$candidates = New-Object System.Collections.Generic.List[object]

function Add-Report {
    param([string]$Line)
    $report.Add($Line) | Out-Null
    Write-Host $Line
}

function Read-TextFile {
    param([string]$Path)
    try {
        return [System.IO.File]::ReadAllText($Path)
    } catch {
        try {
            $bytes = [System.IO.File]::ReadAllBytes($Path)
            return [System.Text.Encoding]::UTF8.GetString($bytes)
        } catch {
            return $null
        }
    }
}

function Try-ParseJson {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    try { return $Text | ConvertFrom-Json -Depth 100 } catch { return $null }
}

function Get-Prop {
    param($Obj, [string]$Name)
    if ($null -eq $Obj) { return $null }
    $prop = $Obj.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

function Count-ArrayProp {
    param($Obj, [string]$Name)
    $value = Get-Prop $Obj $Name
    if ($null -eq $value) { return 0 }
    if ($value -is [array]) { return $value.Count }
    if ($value -is [System.Collections.ICollection]) { return $value.Count }
    return 0
}

function Write-Candidate {
    param(
        [object]$Studio,
        [string]$Source,
        [string]$Label
    )

    if ($null -eq $Studio) { return }
    $questionCount = Count-ArrayProp $Studio "questionBucket"
    $generatorCount = Count-ArrayProp $Studio "generators"
    $submissionCount = Count-ArrayProp $Studio "submissions"
    if ($questionCount -le 0 -and $generatorCount -le 0 -and $submissionCount -le 0) { return }

    $safeLabel = ($Label -replace '[^a-zA-Z0-9_.-]', '_')
    $fileName = "{0:D4}_q{1}_g{2}_s{3}_{4}.json" -f ($candidates.Count + 1), $questionCount, $generatorCount, $submissionCount, $safeLabel
    $outPath = Join-Path $candidateDir $fileName
    $Studio | ConvertTo-Json -Depth 100 | Set-Content -Path $outPath -Encoding UTF8

    $candidate = [pscustomobject]@{
        questions = $questionCount
        generators = $generatorCount
        submissions = $submissionCount
        source = $Source
        label = $Label
        file = $outPath
    }
    $candidates.Add($candidate) | Out-Null
    Add-Report ("FOUND q={0} generators={1} submissions={2} | {3} | {4}" -f $questionCount, $generatorCount, $submissionCount, $Label, $Source)
}

function Inspect-NativeCache {
    param([string]$Path)
    $text = Read-TextFile $Path
    if (-not $text) { return }
    $root = Try-ParseJson $text
    if ($null -eq $root) {
        Add-Report "Could not parse JSON cache: $Path"
        return
    }

    foreach ($key in @("assessment_studio_data_local", "assessment_studio_data")) {
        $rawValue = Get-Prop $root $key
        if ($null -eq $rawValue) { continue }
        $studio = $null
        if ($rawValue -is [string]) {
            $studio = Try-ParseJson $rawValue
        } else {
            $studio = $rawValue
        }
        Write-Candidate -Studio $studio -Source $Path -Label $key
    }
}

function Extract-BalancedJsonAt {
    param([string]$Text, [int]$Start)
    if ($Start -lt 0 -or $Start -ge $Text.Length) { return $null }
    $depth = 0
    $inString = $false
    $escape = $false
    for ($i = $Start; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        if ($escape) { $escape = $false; continue }
        if ($ch -eq '\') { if ($inString) { $escape = $true }; continue }
        if ($ch -eq '"') { $inString = -not $inString; continue }
        if ($inString) { continue }
        if ($ch -eq '{') { $depth++ }
        elseif ($ch -eq '}') {
            $depth--
            if ($depth -eq 0) {
                return $Text.Substring($Start, $i - $Start + 1)
            }
        }
    }
    return $null
}

function Inspect-LevelDbFile {
    param([string]$Path)
    $text = Read-TextFile $Path
    if (-not $text -or $text -notmatch "questionBucket|assessment_studio_data") { return }

    Add-Report "LevelDB file contains Assessment Studio markers: $Path"
    if ($IncludeRawCache) {
        Copy-Item -LiteralPath $Path -Destination (Join-Path $rawDir ([IO.Path]::GetFileName($Path))) -Force
    }

    $markers = @('"questionBucket"', '{\"questionBucket\"')
    foreach ($marker in $markers) {
        $idx = 0
        while ($idx -ge 0 -and $idx -lt $text.Length) {
            $found = $text.IndexOf($marker, $idx, [StringComparison]::Ordinal)
            if ($found -lt 0) { break }
            $start = $text.LastIndexOf('{', $found)
            if ($start -ge 0) {
                $jsonText = Extract-BalancedJsonAt -Text $text -Start $start
                if ($jsonText) {
                    $studio = Try-ParseJson $jsonText
                    if ($null -eq $studio -and $jsonText.Contains('\"')) {
                        $unescaped = $jsonText -replace '\\\"','"' -replace '\\\\','\'
                        $studio = Try-ParseJson $unescaped
                    }
                    Write-Candidate -Studio $studio -Source $Path -Label "leveldb_extracted"
                }
            }
            $idx = $found + $marker.Length
        }
    }
}

Add-Report "Assessment Studio cache recovery scan"
Add-Report "Machine: $env:COMPUTERNAME"
Add-Report "User: $env:USERNAME"
Add-Report "Started: $(Get-Date -Format o)"
Add-Report "Output: $outDir"
Add-Report ""

$likelyRoots = @(
    (Join-Path $env:APPDATA "1st Line Training Portal"),
    (Join-Path $env:APPDATA "1st Line Training Portal-Dev"),
    (Join-Path $env:APPDATA "1st-line-training-portal"),
    (Join-Path $env:APPDATA "1st-line-training-portal-Dev"),
    (Join-Path $env:LOCALAPPDATA "1st Line Training Portal"),
    (Join-Path $env:LOCALAPPDATA "1st Line Training Portal-Dev")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

Add-Report "Scanning likely Electron cache folders:"
foreach ($root in $likelyRoots) { Add-Report " - $root" }
if ($likelyRoots.Count -eq 0) { Add-Report " - No standard app cache folders found." }
Add-Report ""

$nativeFiles = New-Object System.Collections.Generic.List[string]
foreach ($root in $likelyRoots) {
    foreach ($name in @("native_cache.json", "native_cache.json.bak")) {
        $path = Join-Path $root $name
        if (Test-Path $path) { $nativeFiles.Add($path) | Out-Null }
    }
}

Add-Report "Checking native cache files..."
foreach ($path in ($nativeFiles | Select-Object -Unique)) {
    Add-Report "Inspecting $path"
    if ($IncludeRawCache) { Copy-Item -LiteralPath $path -Destination (Join-Path $rawDir ([IO.Path]::GetFileName($path))) -Force }
    Inspect-NativeCache $path
}

Add-Report ""
Add-Report "Checking Chromium Local Storage LevelDB files..."
$levelFiles = New-Object System.Collections.Generic.List[string]
foreach ($root in $likelyRoots) {
    $levelRoot = Join-Path $root "Local Storage\leveldb"
    if (Test-Path $levelRoot) {
        Get-ChildItem $levelRoot -File -Include *.ldb,*.log -Recurse | ForEach-Object { $levelFiles.Add($_.FullName) | Out-Null }
    }
}
foreach ($path in ($levelFiles | Select-Object -Unique)) {
    Inspect-LevelDbFile $path
}

$best = $candidates | Sort-Object -Property questions,generators,submissions -Descending | Select-Object -First 1
Add-Report ""
if ($best) {
    Copy-Item -LiteralPath $best.file -Destination (Join-Path $outDir "BEST_assessment_studio_data_q$($best.questions).json") -Force
    Add-Report ("BEST RECOVERY CANDIDATE: {0} questions, {1} generators, {2} submissions" -f $best.questions, $best.generators, $best.submissions)
    Add-Report "Best source: $($best.source)"
    Add-Report "Best exported JSON: $($best.file)"
} else {
    Add-Report "No parseable Assessment Studio candidates were found on this PC."
}

$csvPath = Join-Path $outDir "candidate_summary.csv"
$candidates | Sort-Object -Property questions,generators,submissions -Descending | Export-Csv -NoTypeInformation -Path $csvPath -Encoding UTF8
Add-Report "Candidate summary: $csvPath"

$reportPath = Join-Path $outDir "report.txt"
$report | Set-Content -Path $reportPath -Encoding UTF8

$zipPath = "$outDir.zip"
Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -Force
Add-Report "Zip created: $zipPath"
Add-Report "Finished: $(Get-Date -Format o)"

Write-Host ""
Write-Host "DONE. Send this zip back for recovery review:"
Write-Host $zipPath
