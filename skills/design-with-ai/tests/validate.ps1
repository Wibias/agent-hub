# validate.ps1 -- structural validation for design-with-ai skill
# Usage (from skill root): pwsh -File .\tests\validate.ps1
# Usage (override):        pwsh -File .\tests\validate.ps1 -SkillRoot <path>
#
# Validates structure only. Does not execute skill logic or assert runtime outcomes.
# Exit 0 = all structural checks pass. Exit 1 = one or more failures.

param(
    [string]$SkillRoot = (Split-Path $PSScriptRoot -Parent)
)

$errors = [System.Collections.Generic.List[string]]::new()
$pass   = [System.Collections.Generic.List[string]]::new()

function Chk($label, $ok, $detail) {
    if ($ok) { $pass.Add("  PASS  $label") }
    else      { $errors.Add("  FAIL  $label`n        -> $detail") }
}

function Get-TextSha256([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hashBytes = $sha.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

# -------------------------------------------------------------------------
# 1. SKILL.md -- metadata and structure
# -------------------------------------------------------------------------
$skillPath = Join-Path $SkillRoot "SKILL.md"
if (-not (Test-Path -Path $skillPath)) {
    $errors.Add("  FAIL  SKILL.md exists`n        -> not found at $skillPath")
    Write-Host "SKILL.md not found -- aborting"; exit 1
}
$skill = Get-Content -Path $skillPath -Raw

Chk "SKILL.md: YAML frontmatter present" `
    ($skill -match '(?s)^---.*?---') `
    "Expected opening/closing '---' YAML frontmatter block at top of file"

Chk "SKILL.md: description field present" `
    ($skill -match 'description:') `
    "No 'description:' key found in frontmatter"

# Description length
$descriptionText = $null
$fmMatch = [regex]::Match($skill, '(?s)^---\r?\n(.+?)\r?\n---')
if ($fmMatch.Success) {
    $fm = $fmMatch.Groups[1].Value
    $dm = [regex]::Match($fm, '(?s)description:\s*>-\s*\r?\n((?:[ \t].+\r?\n?)+)')
    if ($dm.Success) {
        $descriptionText = $dm.Groups[1].Value.Trim()
        $dlen = $descriptionText.Length
        Chk "SKILL.md: description <= 1024 chars" ($dlen -le 1024) "Description is $dlen chars; must be <= 1024"
    } else {
        $sm = [regex]::Match($fm, '(?s)description:(.+)')
        if ($sm.Success) {
            $descriptionText = $sm.Groups[1].Value.Trim()
            $dlen = $descriptionText.Length
            Chk "SKILL.md: description <= 1024 chars" ($dlen -le 1024) "Description is $dlen chars; must be <= 1024"
        } else {
            $errors.Add("  FAIL  SKILL.md: description parse`n        -> Could not extract description text from frontmatter block")
        }
    }
} else {
    $errors.Add("  FAIL  SKILL.md: frontmatter parse`n        -> Could not isolate '---' frontmatter block")
}

if ($null -ne $descriptionText) {
    Chk "SKILL.md: negative trigger -- backend-only" `
        ($descriptionText -match 'backend') `
        "Parsed frontmatter description must exclude backend-only changes (keyword: 'backend')"

    Chk "SKILL.md: negative trigger -- copy-only" `
        ($descriptionText -match 'copy-only') `
        "Parsed frontmatter description must exclude copy-only edits (keyword: 'copy-only')"

    Chk "SKILL.md: negative trigger -- codebase-design" `
        ($descriptionText -match 'codebase-design') `
        "Parsed frontmatter description must redirect API/module interface design to 'codebase-design'"

    Chk "SKILL.md: negative trigger -- code review" `
        ($descriptionText -match 'code review') `
        "Parsed frontmatter description must exclude general code review (phrase: 'code review')"

} else {
    $errors.Add("  FAIL  SKILL.md: negative trigger parse`n        -> Could not validate negative triggers because the frontmatter description could not be parsed")
}

$lc = (Get-Content -Path $skillPath).Count
Chk "SKILL.md: line count < 500" ($lc -lt 500) "SKILL.md is $lc lines; must be < 500 to stay lean"

Chk "SKILL.md: no project-specific rule IDs (C-number / E-number / CONTEXT.md)" `
    (-not ($skill -match '\bC[0-9]+\b\s*/|\bE[0-9]+\b|\bCONTEXT\.md\b')) `
    "Found project-specific rule ID pattern (C-number, E-number, or CONTEXT.md). Use generic 'project-defined locked decision' language."

Chk "SKILL.md: no hardcoded user path" `
    (-not ($skill -match 'C:\\Users\\')) `
    "Hardcoded absolute user path detected; paths must be skill-root-relative"

Chk "SKILL.md: no openai.yaml reference" `
    (-not ($skill -match 'openai\.yaml')) `
    "Reference to openai.yaml found; not permitted in skill files"

Chk "SKILL.md: no backslash in Markdown links" `
    (([regex]::Matches($skill, '\[.*?\]\(.*?\\.*?\)')).Count -eq 0) `
    "One or more Markdown links contain backslash; use forward slashes"


$sourceEvidencePath = Join-Path $SkillRoot "references/source-evidence.md"
if (Test-Path -LiteralPath $sourceEvidencePath) {
    $sourceEvidence = Get-Content -LiteralPath $sourceEvidencePath -Raw
    foreach ($requiredPattern in @(
        'TESTED',
        'OBSERVED',
        'INTERPRETED',
        'INSPIRATION',
        'MARKETING_CLAIM',
        'reference MCP',
        'UNAVAILABLE',
        'PAYWALLED',
        'Design-system readiness check',
        'Generation brief',
        'Local validation required'
    )) {
        Chk "source-evidence.md: contains '$requiredPattern'" `
            ($sourceEvidence -match [regex]::Escape($requiredPattern)) `
            "Missing required source-evidence contract term: $requiredPattern"
    }
}

# -------------------------------------------------------------------------
# 2. SKILL.md -- ## Reference map list
# -------------------------------------------------------------------------
Chk "SKILL.md: ## Reference map section present" `
    ($skill -match '## Reference map') `
    "Missing '## Reference map' section. Required for parseable one-level reference routing."

$rmSection = [regex]::Match($skill, '(?s)## Reference map(.+?)(?=\n##|\n<!--|\z)')
if ($rmSection.Success) {
    $rmText = $rmSection.Groups[1].Value
    $pathMatches = [regex]::Matches($rmText, '(?m)^\s*-\s+`(references/[^`]+)`\s*:')
    $parsedPaths = @()
    foreach ($m in $pathMatches) {
        $rp = $m.Groups[1].Value.Trim()
        $parsedPaths += $rp
        $full = Join-Path $SkillRoot $rp
        Chk "Reference map: path exists -- $rp" `
            (Test-Path -Path $full) `
            "File listed in Reference map not found at: $full"
    }
    Chk "Reference map: >= 4 entries" `
        ($parsedPaths.Count -ge 4) `
        "Reference map has $($parsedPaths.Count) parseable path entries; expected >= 4"
    Chk "Reference map: includes design-methods.md" `
        ($rmText -match 'design-methods') `
        "references/design-methods.md not listed in Reference map"
    Chk "Reference map: includes verification-contract.md" `
        ($rmText -match 'verification') `
        "references/verification-contract.md not listed in Reference map"
} else {
    $errors.Add("  FAIL  Reference map: parse`n        -> Could not extract ## Reference map section body from SKILL.md")
}

# -------------------------------------------------------------------------
# 3. SKILL.md -- <!-- eval:references --> marker block
# -------------------------------------------------------------------------
Chk "SKILL.md: eval:references opening marker present" `
    ($skill -match '<!--\s*eval:references\s*-->') `
    "Missing '<!-- eval:references -->' marker. Required for cross-validator reference discovery."

Chk "SKILL.md: eval:references closing marker present" `
    ($skill -match '<!--\s*/eval:references\s*-->') `
    "Missing '<!-- /eval:references -->' closing marker."

$evalRefBlock = [regex]::Match($skill, '(?s)<!--\s*eval:references\s*-->(.*?)<!--\s*/eval:references\s*-->')
if ($evalRefBlock.Success) {
    $erText = $evalRefBlock.Groups[1].Value
    $erPaths = $erText -split "`r?`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -match '^-\s+(references/|tests/evals/)' } |
        ForEach-Object { ($_ -replace '^-\s+', '') -replace '\s+--.*$', '' }
    foreach ($erp in $erPaths) {
        $full = Join-Path $SkillRoot $erp
        Chk "eval:references: path exists -- $erp" `
            (Test-Path -Path $full) `
            "Path listed in eval:references block not found at: $full"
    }
    Chk "eval:references: includes cases.jsonl" `
        ($erText -match 'cases\.jsonl') `
        "tests/evals/cases.jsonl must be listed in eval:references block"
    Chk "eval:references: includes regression-cases.jsonl" `
        ($erText -match 'regression-cases\.jsonl') `
        "tests/evals/regression-cases.jsonl must be listed in eval:references block"
    Chk "eval:references: includes verification-contract.md" `
        ($erText -match 'verification-contract') `
        "references/verification-contract.md must be listed in eval:references block"
    Chk "eval:references: >= 5 entries" `
        ($erPaths.Count -ge 5) `
        "eval:references block has $($erPaths.Count) entries; expected >= 5"
} else {
    $errors.Add("  FAIL  eval:references: block parse`n        -> Could not extract content between eval:references markers")
}

# -------------------------------------------------------------------------
# 4. All required reference files exist
# -------------------------------------------------------------------------
$requiredRefs = @(
    "references/existing-ui-workflows.md"
    "references/motion-workflows.md"
    "references/new-product-surface.md"
    "references/verification-contract.md"
    "references/design-methods.md"
    "references/source-evidence.md"
    "references/reference-library.md"
)
foreach ($r in $requiredRefs) {
    Chk "Required reference file exists: $r" `
        (Test-Path -Path (Join-Path $SkillRoot $r)) `
        "Expected reference file not found: $(Join-Path $SkillRoot $r)"
}

# No project-specific rule IDs in any reference file
foreach ($r in $requiredRefs) {
    $rp = Join-Path $SkillRoot $r
    if (Test-Path -Path $rp) {
        $rc = Get-Content -Path $rp -Raw
        Chk "No project rule IDs in $r" `
            (-not ($rc -match '\bC[0-9]+\b\s*/|\bE[0-9]+\b|\bCONTEXT\.md\b')) `
            "Found project-specific rule ID (C-number / E-number / CONTEXT.md) in $r. Use generic locked-decision language."
    }
}

# -------------------------------------------------------------------------
# 5. Command router coverage in SKILL.md
# -------------------------------------------------------------------------
$cmds = @("audit-surface","improve-existing","restyle-existing",
          "redesign-existing","build-product-surface",
          "motion-opportunities","motion-audit","motion-review","motion-optimize")
foreach ($c in $cmds) {
    Chk "Command in router: $c" `
        ($skill -match [regex]::Escape($c)) `
        "Command '$c' not found in SKILL.md command router table"
}

# -------------------------------------------------------------------------
# 6. Command contracts in reference files
# -------------------------------------------------------------------------
$commandContracts = @(
    [pscustomobject]@{
        Command = "audit-surface"
        File = "references/existing-ui-workflows.md"
        HeadingPattern = '##\s+`audit-surface`'
        Scope = "section"
        Required = @('Read-only','surface classification','product-role verdict','visible evidence','Standard/deep','Do not edit')
    },
    [pscustomobject]@{
        Command = "improve-existing"
        File = "references/existing-ui-workflows.md"
        HeadingPattern = '##\s+`improve-existing`'
        Scope = "section"
        Required = @('PRODUCT MODEL: SOUND \| UNCERTAIN \| WRONG','anti-slop inventory','quality-stack\.md','quick','standard','deep','desktop and\s+mobile verification')
    },
    [pscustomobject]@{
        Command = "restyle-existing"
        File = "references/existing-ui-workflows.md"
        HeadingPattern = '##\s+`restyle-existing`'
        Scope = "section"
        Required = @('Purpose, IA, routes','visual world','taste-workflow\.md','at least two genuinely different visual worlds','redirect to\s+`redesign-existing`')
    },
    [pscustomobject]@{
        Command = "redesign-existing"
        File = "references/existing-ui-workflows.md"
        HeadingPattern = '##\s+`redesign-existing`'
        Scope = "section"
        Required = @('product-role verdict','PROMOTE.*KEEP.*DEMOTE.*MOVE','2-3 genuinely different','implementation lock','similarity veto','kill gate','No sunk-cost exception')
    },
    [pscustomobject]@{
        Command = "build-product-surface"
        File = "references/new-product-surface.md"
        HeadingPattern = '##\s+Command contract:\s+`build-product-surface`'
        Scope = "section"
        Required = @('standard \| deep','Surface name','state surface map','core-design-workflow\.md','conditional intelligence','taste-workflow\.md','verification-contract\.md','stop')
    },
    [pscustomobject]@{
        Command = "motion-opportunities"
        File = "references/motion-workflows.md"
        HeadingPattern = '##\s+`motion-opportunities`'
        Scope = "section"
        Required = @('opportunities\.md','approved and rejected candidates','zero survivors','Do not implement')
    },
    [pscustomobject]@{
        Command = "motion-audit"
        File = "references/motion-workflows.md"
        HeadingPattern = '##\s+`motion-audit`'
        Scope = "section"
        Required = @('Recon.*audit','quick.*standard.*deep','vetted','Present findings before planning')
    },
    [pscustomobject]@{
        Command = "motion-review"
        File = "references/motion-workflows.md"
        HeadingPattern = '##\s+`motion-review`'
        Scope = "section"
        Required = @('bounded diff/surface','current source evidence','Block.*Approve','reduced-motion')
    },
    [pscustomobject]@{
        Command = "motion-optimize"
        File = "references/motion-performance.md"
        HeadingPattern = '^#\s+Motion runtime performance'
        Scope = "file"
        Required = @('Use for `motion-optimize`','Capture a live baseline','JavaScript loops','Reprofile the same states','preserve useful visible motion')
    }
)
foreach ($contract in $commandContracts) {
    $fp = Join-Path $SkillRoot $contract.File
    Chk "Command contract file exists: $($contract.Command)" `
        (Test-Path -Path $fp) `
        "Expected command contract file for '$($contract.Command)' at $($contract.File)"

    if (Test-Path -Path $fp) {
        $fc = Get-Content -Path $fp -Raw
        $headingPresent = $fc -match "(?im)$($contract.HeadingPattern)"
        Chk "Command contract heading present: $($contract.Command)" `
            $headingPresent `
            "Could not find the command contract heading for '$($contract.Command)' in $($contract.File)"

        if ($headingPresent) {
            if ($contract.Scope -eq "file") {
                $contractText = $fc
            } else {
                $pattern = "(?s)$($contract.HeadingPattern)(.*?)(?=\r?\n## |\z)"
                $section = [regex]::Match($fc, $pattern)
                Chk "Command contract section isolated: $($contract.Command)" `
                    $section.Success `
                    "Could not isolate the command contract section for '$($contract.Command)' in $($contract.File)"
                $contractText = if ($section.Success) { $section.Groups[1].Value } else { "" }
            }

            foreach ($requiredPattern in $contract.Required) {
                Chk "Command '$($contract.Command)': canonical contract pattern '$requiredPattern'" `
                    ($contractText -match "(?is)$requiredPattern") `
                    "Command '$($contract.Command)' is missing current contract detail matching '$requiredPattern'"
            }
        }
    }
}

# -------------------------------------------------------------------------
# 7. cases.jsonl -- schema, model_config, required IDs, forbidden content
# -------------------------------------------------------------------------
$casesPath = Join-Path $SkillRoot "tests/evals/cases.jsonl"
Chk "tests/evals/cases.jsonl: file exists" `
    (Test-Path -Path $casesPath) `
    "Expected at: $(Join-Path $SkillRoot 'tests/evals/cases.jsonl')"

# Canonical schema fields required on every entry. Review cases additionally require scenario;
# model_config is validated separately below, matching the canonical Skill Ratchet validator.
$canonicalFields = @("id","category","invocation","prompt","expected_skill",
                     "expected_resources","unnecessary_resources","assertion_ids")

if (Test-Path -Path $casesPath) {
    $caseLines = Get-Content -Path $casesPath | Where-Object { $_.Trim() -ne '' }
    $foundIds       = [System.Collections.Generic.List[string]]::new()
    $modelConfigObj = $null
    $lineNum        = 0

    foreach ($line in $caseLines) {
        $lineNum++
        try {
            $obj   = $line | ConvertFrom-Json -ErrorAction Stop
            $props = $obj.PSObject.Properties.Name

            # Config metadata and executable/review cases have different canonical shapes.
            $requiredFields = @($canonicalFields)
            if ($obj.category -ne 'config') { $requiredFields += 'scenario' }
            foreach ($field in $requiredFields) {
                Chk "cases.jsonl line $lineNum (category=$($obj.category)): canonical field '$field' present" `
                    ($props -contains $field) `
                    "Canonical schema requires field '$field' on this entry (line $lineNum, id='$($obj.id)', category='$($obj.category)')"
            }

            if ($props -contains 'id') { $foundIds.Add([string]$obj.id) }

            # Capture model_config entry for later validation
            if ($obj.category -eq 'config') { $modelConfigObj = $obj }

            if ($obj.category -ne 'config') {
                $resources = @()
                if ($props -contains 'expected_resources' -and $null -ne $obj.expected_resources) {
                    $resources = @($obj.expected_resources)
                }
                $assertions = @()
                if ($props -contains 'assertion_ids' -and $null -ne $obj.assertion_ids) {
                    $assertions = @($obj.assertion_ids)
                }
                $stopBeforeResources = @('no-reference-loaded','asks-for-concrete-target') | Where-Object { $assertions -contains $_ }
                $requiresDesignSkillRoot = ($props -contains 'expected_skill' -and [string]$obj.expected_skill -eq 'design-with-ai')
                if ($requiresDesignSkillRoot -and $stopBeforeResources.Count -gt 0) {
                    Chk "cases.jsonl line $lineNum (id='$($obj.id)'): expected_resources empty when stop-before-reference assertions apply" `
                        ($resources.Count -eq 0) `
                        "Case '$($obj.id)' has stop-before-reference assertions ($($stopBeforeResources -join ', ')) so expected_resources must be []"
                } elseif ($requiresDesignSkillRoot) {
                    Chk "cases.jsonl line $lineNum (id='$($obj.id)'): expected_resources starts with SKILL.md" `
                        ($resources.Count -ge 1 -and $resources[0] -eq 'SKILL.md') `
                        "design-with-ai case '$($obj.id)' must list SKILL.md first in expected_resources unless it intentionally halts before any resource load"
                }
                if ($resources -contains 'SKILL.md') {
                    $skillPositions = for ($i = 0; $i -lt $resources.Count; $i++) { if ($resources[$i] -eq 'SKILL.md') { $i } }
                    Chk "cases.jsonl line $lineNum (id='$($obj.id)'): SKILL.md appears once and only first" `
                        ($skillPositions.Count -eq 1 -and $skillPositions[0] -eq 0) `
                        "Case '$($obj.id)' must include SKILL.md at most once and only as the first expected_resources entry"
                }
            }

        } catch {
            $errors.Add("  FAIL  cases.jsonl line ${lineNum}: invalid JSON`n        -> $_")
        }
    }

    # --- model_config entry ---
    Chk "cases.jsonl: model_config entry present (id=model_config, category=config)" `
        ($foundIds -contains 'model_config') `
        "No entry with id='model_config' and category='config' found. Required for cross-validator model-hint integration."

    if ($null -ne $modelConfigObj) {
        $mcProps = $modelConfigObj.PSObject.Properties.Name
        Chk "model_config: strong_model_hint field present" `
            ($mcProps -contains 'strong_model_hint') `
            "model_config entry is missing 'strong_model_hint'. Required for eval harness; value must be a capability descriptor, not a concrete model name."
        Chk "model_config: weaker_model_hint field present" `
            ($mcProps -contains 'weaker_model_hint') `
            "model_config entry is missing 'weaker_model_hint'. Required for eval harness; value must be a capability descriptor, not a concrete model name."
        if ($mcProps -contains 'strong_model_hint') {
            Chk "model_config: strong_model_hint is a non-empty string" `
                ([string]$modelConfigObj.strong_model_hint -ne '') `
                "strong_model_hint must be a non-empty capability descriptor string"
        }
        if ($mcProps -contains 'weaker_model_hint') {
            Chk "model_config: weaker_model_hint is a non-empty string" `
                ([string]$modelConfigObj.weaker_model_hint -ne '') `
                "weaker_model_hint must be a non-empty capability descriptor string"
        }
    }

    # --- Required canonical case ID sets (excludes model_config) ---
    $caseIds     = $foundIds | Where-Object { $_ -ne 'model_config' }
    $requiredD   = @("D1","D2","D3")
    $requiredN   = @("N1","N2","N3","N4")
    $requiredE   = 1..30 | ForEach-Object { "E$_" }
    $requiredER  = @("ER1","ER2","ER3")
    $requiredA   = @("A1","A2","A3","A4","A5","A6")
    foreach ($id in ($requiredD + $requiredN + $requiredE + $requiredER + $requiredA)) {
        Chk "cases.jsonl: required ID '$id' present" `
            ($caseIds -contains $id) `
            "Required canonical case ID '$id' not found in cases.jsonl"
    }

    # --- Exactly A1-A6; no A7+ and no ADV IDs ---
    $extraA = $caseIds | Where-Object { $_ -match '^A[0-9]+$' -and $_ -notin $requiredA }
    Chk "cases.jsonl: no A-series IDs beyond A1-A6 (found: $($extraA -join ', ' | Where-Object {$_}))" `
        ($extraA.Count -eq 0) `
        "Extra A-series IDs found: $($extraA -join ', '). Only A1-A6 are reserved canonical adversarial IDs."

    $advIds = $caseIds | Where-Object { $_ -match '^ADV' }
    Chk "cases.jsonl: no ADV-series IDs (found: $($advIds -join ', ' | Where-Object {$_}))" `
        ($advIds.Count -eq 0) `
        "ADV-series IDs found: $($advIds -join ', '). Use A1-A6 for canonical adversarial cases."

    # --- No PENDING or run-result fields ---
    $casesRaw = Get-Content -Path $casesPath -Raw
    Chk "cases.jsonl: no PENDING values (run results must live in TEMP only)" `
        (-not ($casesRaw -match '"PENDING"')) `
        "Found literal 'PENDING' string. Run results/outcomes must live in TEMP, not in the staged skill."
    Chk "cases.jsonl: no run-result fields (outcome / model_name / run_result / actual_behavior)" `
        (-not ($casesRaw -match '"outcome"\s*:|"model_name"\s*:|"run_result"\s*:|"actual_behavior"\s*:')) `
        "Run-result field detected. Model names and run outcomes must live in TEMP, not in staged files."
}

# -------------------------------------------------------------------------
# 8. regression-cases.jsonl -- schema, forbidden IDs, no run results
# -------------------------------------------------------------------------
$regPath = Join-Path $SkillRoot "tests/evals/regression-cases.jsonl"
Chk "tests/evals/regression-cases.jsonl: file exists" `
    (Test-Path -Path $regPath) `
    "Expected at: $(Join-Path $SkillRoot 'tests/evals/regression-cases.jsonl')"

if (Test-Path -Path $regPath) {
    $regLines  = Get-Content -Path $regPath | Where-Object { $_.Trim() -ne '' }
    $regIds    = [System.Collections.Generic.List[string]]::new()
    $regLineNum = 0

    foreach ($line in $regLines) {
        $regLineNum++
        try {
            $obj   = $line | ConvertFrom-Json -ErrorAction Stop
            $props = $obj.PSObject.Properties.Name
            $regressionFields = @($canonicalFields) + @('scenario','added')
            foreach ($field in $regressionFields) {
                Chk "regression-cases.jsonl line $regLineNum (id='$($obj.id)'): canonical field '$field' present" `
                    ($props -contains $field) `
                    "Canonical regression schema requires field '$field' (line $regLineNum, id='$($obj.id)')"
            }
            if ($props -contains 'id') { $regIds.Add([string]$obj.id) }

            $resources = @()
            if ($props -contains 'expected_resources' -and $null -ne $obj.expected_resources) {
                $resources = @($obj.expected_resources)
            }
            $assertions = @()
            if ($props -contains 'assertion_ids' -and $null -ne $obj.assertion_ids) {
                $assertions = @($obj.assertion_ids)
            }
            $stopBeforeResources = @('no-workflow-reference-loaded','asks-for-concrete-target') | Where-Object { $assertions -contains $_ }
            $requiresSkillRoot = ($props -contains 'expected_skill' -and $null -ne $obj.expected_skill -and [string]$obj.expected_skill -ne '')
            if ($requiresSkillRoot -and $stopBeforeResources.Count -gt 0) {
                Chk "regression-cases.jsonl line $regLineNum (id='$($obj.id)'): only SKILL.md loads before workflow stop" `
                    ($resources.Count -eq 1 -and $resources[0] -eq 'SKILL.md') `
                    "Regression '$($obj.id)' must activate through SKILL.md but load no workflow references before requesting a target"
            } elseif ($requiresSkillRoot) {
                Chk "regression-cases.jsonl line $regLineNum (id='$($obj.id)'): expected_resources starts with SKILL.md" `
                    ($resources.Count -ge 1 -and $resources[0] -eq 'SKILL.md') `
                    "Triggered regression '$($obj.id)' must list SKILL.md first in expected_resources unless it intentionally halts before any resource load"
            }
            if ($resources -contains 'SKILL.md') {
                $skillPositions = for ($i = 0; $i -lt $resources.Count; $i++) { if ($resources[$i] -eq 'SKILL.md') { $i } }
                Chk "regression-cases.jsonl line $regLineNum (id='$($obj.id)'): SKILL.md appears once and only first" `
                    ($skillPositions.Count -eq 1 -and $skillPositions[0] -eq 0) `
                    "Regression '$($obj.id)' must include SKILL.md at most once and only as the first expected_resources entry"
            }
        } catch {
            $errors.Add("  FAIL  regression-cases.jsonl line ${regLineNum}: invalid JSON`n        -> $_")
        }
    }
    $caseObjects = @($caseLines | ForEach-Object { $_ | ConvertFrom-Json })
    $expectedNearMissPrompts = @{
        N1 = 'add a Redis rate-limit middleware to the API server'
        N2 = 'design the interface for the new quiz engine adapter'
        N3 = 'impeccable polish src/routes/settings.tsx'
        N4 = 'Create a standalone matplotlib chart from this CSV for my analysis report'
    }
    foreach ($id in $expectedNearMissPrompts.Keys) {
        $row = @($caseObjects | Where-Object { $_.id -ceq $id }) | Select-Object -First 1
        $expectedSkill = if ($id -ceq 'N3') { 'impeccable' } else { $null }
        $skillMatches = if ($null -eq $expectedSkill) {
            $null -eq $row.expected_skill
        } else {
            [string]$row.expected_skill -ceq $expectedSkill
        }
        Chk "cases.jsonl: near-miss '$id' exact prompt and owner semantics" `
            ($null -ne $row -and $row.prompt -ceq $expectedNearMissPrompts[$id] -and $row.category -ceq 'must-not-trigger' -and $skillMatches) `
            "Near-miss '$id' must retain its exact prompt, must-not-trigger category, and current owner boundary"
    }

    $expectedNearMissHashes = @{
        N1 = '43f8b085936bf5459a3c6c9bd7a2139fd6626da72bbba66aa37376fde720747c'
        N2 = 'b92eb1a1b1a99d8409d71fdfd56d9b1cad0fc10e9cfc8942dce260386501336d'
        N3 = '91da51cc64299a8c4599e35281af12420d78d37afa39069bae8492c4d2a86f07'
        N4 = '6794d1349c7c99ff422ece74ae92c6f50e943dddf12c252cb3dd035f93ac3801'
    }
    foreach ($id in $expectedNearMissHashes.Keys) {
        $line = @($caseLines | Where-Object { ($_ | ConvertFrom-Json).id -ceq $id }) | Select-Object -First 1
        $actualHash = if ($line) {
            [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($line))).ToLowerInvariant()
        } else { '' }
        Chk "cases.jsonl: near-miss '$id' full semantics hash" `
            ($actualHash -ceq $expectedNearMissHashes[$id]) `
            "Near-miss '$id' invocation/resources/assertions/scenario semantics changed; add a new case instead of mutating the retained fixture"
    }

    # No A-series or ADV-series IDs
    $forbA   = $regIds | Where-Object { $_ -match '^A[0-9]+$' }
    $forbADV = $regIds | Where-Object { $_ -match '^ADV' }
    Chk "regression-cases.jsonl: no A-series IDs (reserved for cases.jsonl)" `
        ($forbA.Count -eq 0) `
        "A-series IDs found in regression-cases.jsonl: $($forbA -join ', '). A1-A6 are reserved for cases.jsonl only."
    Chk "regression-cases.jsonl: no ADV-series IDs" `
        ($forbADV.Count -eq 0) `
        "ADV-series IDs found: $($forbADV -join ', '). Not permitted in any eval file."

    $regRaw = Get-Content -Path $regPath -Raw
    Chk "regression-cases.jsonl: no PENDING values" `
        (-not ($regRaw -match '"PENDING"')) `
        "Found 'PENDING' in regression-cases.jsonl. Run results must live in TEMP only."
    Chk "regression-cases.jsonl: no run-result fields" `
        (-not ($regRaw -match '"outcome"\s*:|"model_name"\s*:|"run_result"\s*:|"actual_behavior"\s*:')) `
        "Run-result field detected in regression-cases.jsonl. Must live in TEMP only."
    Chk "regression-cases.jsonl: at least 1 regression entry" `
        ($regIds.Count -ge 1) `
        "regression-cases.jsonl is empty; expected at least 1 design-specific regression case"

    $lockPath = Join-Path $SkillRoot "tests/evals/regression-lock.json"
    Chk "tests/evals/regression-lock.json: file exists" `
        (Test-Path -Path $lockPath) `
        "Expected immutable regression lock manifest at: $lockPath"
    if (Test-Path -Path $lockPath) {
        try {
            $lock = Get-Content -Path $lockPath -Raw | ConvertFrom-Json -NoEnumerate -ErrorAction Stop
            $isArrayRoot = $lock -is [System.Array]
            Chk "regression-lock.json: root is canonical array" `
                $isArrayRoot `
                "regression-lock.json root must be an array of { id, sha256 } entries"
            if ($isArrayRoot) {
                $lockedCases = @($lock)
                Chk "regression-lock.json: locked case count matches regression file" `
                    ($lockedCases.Count -eq $regLines.Count) `
                    "regression-lock.json has $($lockedCases.Count) entries but regression-cases.jsonl has $($regLines.Count) non-empty line(s)"
                $lockedById = @{}
                foreach ($entry in $lockedCases) {
                    $entryProps = $entry.PSObject.Properties.Name
                    Chk "regression-lock.json entry: id present" `
                        ($entryProps -contains 'id' -and [string]$entry.id -ne '') `
                        "Each regression lock entry must include a non-empty id"
                    Chk "regression-lock.json entry '$($entry.id)': sha256 present" `
                        ($entryProps -contains 'sha256' -and [string]$entry.sha256 -ne '') `
                        "Regression lock entry '$($entry.id)' must include a non-empty sha256"
                    if ($entryProps -contains 'id' -and [string]$entry.id -ne '') {
                        $lockedById[[string]$entry.id] = [string]$entry.sha256
                    }
                }
                foreach ($line in $regLines) {
                    try {
                        $obj = $line | ConvertFrom-Json -ErrorAction Stop
                        $id = [string]$obj.id
                        $expectedHash = Get-TextSha256 $line
                        Chk "regression-lock.json: locked id present for '$id'" `
                            ($lockedById.ContainsKey($id)) `
                            "Regression '$id' is missing from regression-lock.json; deletion from the lock manifest is not allowed"
                        if ($lockedById.ContainsKey($id)) {
                            Chk "regression-lock.json: hash matches '$id'" `
                                ($lockedById[$id] -eq $expectedHash) `
                                "Regression '$id' content changed without updating its immutable lock entry. Expected $expectedHash but found $($lockedById[$id])"
                        }
                    } catch {
                        $errors.Add("  FAIL  regression-lock.json: line hash parse`n        -> Could not parse regression line while checking the lock manifest: $_")
                    }
                }
            }
        } catch {
            $errors.Add("  FAIL  regression-lock.json: invalid JSON`n        -> $_")
        }
    }
}

# -------------------------------------------------------------------------
# 9. Legacy eval-cases.md must NOT exist (replaced by JSONL)
# -------------------------------------------------------------------------
Chk "Legacy tests/eval-cases.md removed (replaced by JSONL)" `
    (-not (Test-Path -Path (Join-Path $SkillRoot "tests/eval-cases.md"))) `
    "tests/eval-cases.md still present. It has been replaced by tests/evals/cases.jsonl and tests/evals/regression-cases.jsonl. Delete it."

# -------------------------------------------------------------------------
# Report
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "=== design-with-ai structural validation ==="
Write-Host "    SkillRoot : $SkillRoot"
Write-Host "    Timestamp : $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ' -AsUTC)"
Write-Host "    Note      : structural checks only -- no runtime eval outcomes asserted"
Write-Host ""
foreach ($p in $pass) { Write-Host $p }
if ($errors.Count -gt 0) {
    Write-Host ""
    foreach ($e in $errors) { Write-Host $e }
    Write-Host ""
    Write-Host "Result: $($errors.Count) failure(s), $($pass.Count) pass(es)"
    exit 1
}
Write-Host ""
Write-Host "Result: all $($pass.Count) structural checks passed"
exit 0
