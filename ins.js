import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectDir = path.dirname(fileURLToPath(import.meta.url));
const dependencies = [
  "node-v20.18.0-x64.msi",
  "postgresql-17.2-1-windows-x64.exe"
];

function innoPaths() {
  if (process.env.ISCC) return [process.env.ISCC];
  return [
    path.join(process.env["ProgramFiles(x86)"] || "", "Inno Setup 6", "ISCC.exe"),
    path.join(process.env.ProgramFiles || "", "Inno Setup 6", "ISCC.exe")
  ].filter(candidate => path.isAbsolute(candidate));
}

function psProvisioner() {
  return String.raw`param(
  [Parameter(Mandatory = $true)][string]$AppDir,
  [Parameter(Mandatory = $true)][string]$NodeMsi,
  [Parameter(Mandatory = $true)][string]$PostgresInstaller,
  [Parameter(Mandatory = $true)][string]$DatabaseSql
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [BitConverter]::ToString($bytes).Replace("-", "")
}

function Invoke-CheckedProcess([string]$FilePath, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0)) {
  $quotedArguments = $Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
  $process = Start-Process -FilePath $FilePath -ArgumentList ($quotedArguments -join " ") -Wait -PassThru
  if ($process.ExitCode -notin $AllowedExitCodes) {
    throw "$([IO.Path]::GetFileName($FilePath)) failed with exit code $($process.ExitCode)."
  }
}

try {
  if (Test-Path -LiteralPath (Join-Path $AppDir ".env")) {
    throw "An existing HardwareOps configuration was found at $AppDir. Remove the existing app and PostgreSQL 17 service before installing again."
  }
  if (Get-Service -Name "postgresql-x64-17" -ErrorAction SilentlyContinue) {
    throw "The PostgreSQL 17 service already exists. Remove it before installing HardwareOps."
  }

  Invoke-CheckedProcess "$env:SystemRoot\System32\msiexec.exe" @("/i", $NodeMsi, "/qn", "/norestart") @(0, 3010)

  $dbAdminPassword = New-Secret
  $dbPassword = New-Secret
  $ownerPassword = New-Secret
  $pgArgs = @(
    "--mode", "unattended",
    "--unattendedmodeui", "none",
    "--superpassword=$dbAdminPassword",
    "--serverport=5432",
    "--servicename=postgresql-x64-17",
    "--prefix=$env:ProgramFiles\PostgreSQL\17",
    "--datadir=$env:ProgramFiles\PostgreSQL\17\data",
    "--install_runtimes=0"
  )
  Invoke-CheckedProcess $PostgresInstaller $pgArgs

  $psql = Join-Path $env:ProgramFiles "PostgreSQL\17\bin\psql.exe"
  $service = Get-Service -Name "postgresql-x64-17" -ErrorAction Stop
  if ($service.Status -ne "Running") { Start-Service -Name $service.Name }
  $databaseReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $probe = [System.Net.Sockets.TcpClient]::new()
    try {
      $probe.Connect("127.0.0.1", 5432)
      $databaseReady = $true
      break
    }
    catch {
      Start-Sleep -Seconds 1
    }
    finally {
      $probe.Dispose()
    }
  }
  if (-not $databaseReady) { throw "PostgreSQL did not start listening on port 5432." }

  $env:PGPASSWORD = $dbAdminPassword
  Invoke-CheckedProcess $psql @("-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "CREATE ROLE hardwareops LOGIN PASSWORD '$dbPassword';")
  Invoke-CheckedProcess $psql @("-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", "CREATE DATABASE hardwareops OWNER hardwareops;")

  $env:PGPASSWORD = $dbPassword
  Invoke-CheckedProcess $psql @("-h", "127.0.0.1", "-U", "hardwareops", "-d", "hardwareops", "-v", "ON_ERROR_STOP=1", "-f", $DatabaseSql)

  $envText = @"
DATABASE_URL=postgres://hardwareops:$dbPassword@127.0.0.1:5432/hardwareops
PGSSLMODE=disable
PORT=4000
AUTH_BOOTSTRAP_EMAIL=rick@store.lk
AUTH_BOOTSTRAP_PASSWORD=$ownerPassword
"@
  [IO.File]::WriteAllText((Join-Path $AppDir ".env"), $envText, [Text.UTF8Encoding]::new($false))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $envFile = Join-Path $AppDir ".env"
  $envAcl = Get-Acl -LiteralPath $envFile
  $envAcl.SetAccessRuleProtection($true, $false)
  $envAcl.Access | ForEach-Object { [void]$envAcl.RemoveAccessRule($_) }
  foreach ($principal in @($identity, "BUILTIN\Administrators", "NT AUTHORITY\SYSTEM")) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $principal,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    )
    $envAcl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $envFile -AclObject $envAcl

  $credentialsFile = Join-Path ([Environment]::GetFolderPath("MyDocuments")) ("HardwareOps-First-Login-" + [Guid]::NewGuid().ToString("N") + ".txt")
  $credentials = @"
HardwareOps initial Owner account
Email: rick@store.lk
Password: $ownerPassword

Change this password after signing in. This file can be deleted once the password has been changed.
"@
  [IO.File]::WriteAllText($credentialsFile, $credentials, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $AppDir ".setup-complete"), "HardwareOps provisioned successfully.", [Text.UTF8Encoding]::new($false))
}
catch {
  [System.Windows.Forms.MessageBox]::Show(
    ("HardwareOps setup failed:" + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + "No application shortcut will be launched. Contact your administrator or rerun the installer after resolving the issue."),
    "HardwareOps Setup",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}`;
}

function appLauncher() {
  return String.raw`$ErrorActionPreference = "Stop"
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$setupMarker = Join-Path $appDir ".setup-complete"
if (-not (Test-Path -LiteralPath $setupMarker)) {
  throw "HardwareOps setup has not completed successfully. Rerun the installer."
}
$node = Join-Path $env:ProgramFiles "nodejs\node.exe"
if (-not (Test-Path -LiteralPath $node)) {
  throw "Node.js was not found at $node."
}

$client = [System.Net.Sockets.TcpClient]::new()
try {
  $client.Connect("127.0.0.1", 4000)
}
catch {
  Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $appDir -WindowStyle Hidden
}
finally {
  $client.Dispose()
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $probe = [System.Net.Sockets.TcpClient]::new()
  try {
    $probe.Connect("127.0.0.1", 4000)
    $ready = $true
    break
  }
  catch {
    Start-Sleep -Milliseconds 500
  }
  finally {
    $probe.Dispose()
  }
}
if (-not $ready) { throw "HardwareOps did not start listening on port 4000." }
Start-Process -FilePath (Join-Path $appDir "index.html")`;
}

function installerDefinition({ projectDir, outputDir, buildDir, version, iconPath }) {
  const root = projectDir.replaceAll("/", "\\").replaceAll('"', '""');
  const iconSetting = iconPath ? `SetupIconFile="${iconPath.replaceAll("/", "\\")}"` : "";
  return `#define ProjectRoot "${root}"

[Setup]
AppId={{EB96836F-E410-4B4C-9D3A-A4D728D8B344}
AppName=HardwareOps Optimizer
AppVersion=${version}
AppPublisher=HardwareOps
DefaultDirName={autopf}\\HardwareOps
DefaultGroupName=HardwareOps Optimizer
OutputDir="${outputDir.replaceAll("/", "\\")}"
OutputBaseFilename=HardwareOps-Setup-${version}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
${iconSetting}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
Name: "{app}"

[Files]
Source: "{#ProjectRoot}\\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\\index.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\\db.sql"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\\package-lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjectRoot}\\node_modules\\*"; DestDir: "{app}\\node_modules"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "{#ProjectRoot}\\installers\\${dependencies[0]}"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "{#ProjectRoot}\\installers\\${dependencies[1]}"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "${buildDir.replaceAll("/", "\\")}\\provision.ps1"; DestDir: "{tmp}"; Flags: deleteafterinstall
Source: "${buildDir.replaceAll("/", "\\")}\\start.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\\HardwareOps Optimizer"; Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\\start.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\\HardwareOps Optimizer"; Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\\start.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{tmp}\\provision.ps1"" -AppDir ""{app}"" -NodeMsi ""{tmp}\\${dependencies[0]}"" -PostgresInstaller ""{tmp}\\${dependencies[1]}"" -DatabaseSql ""{app}\\db.sql"""; Flags: postinstall waituntilterminated runhidden
Filename: "{sys}\\WindowsPowerShell\\v1.0\\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\\start.ps1"""; Description: "Launch HardwareOps Optimizer"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
`;
}

async function requireFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} is missing: ${filePath}`);
  }
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("exe.js must be run on Windows with Inno Setup 6 installed.");
  }

  const packageJson = JSON.parse(await readFile(path.join(projectDir, "package.json"), "utf8"));
  const outputDir = path.join(projectDir, "dist");
  const installersDir = path.join(projectDir, "installers");
  const requiredFiles = [
    ["server.js", "Application server"],
    ["index.html", "Application UI"],
    ["db.sql", "Database schema"],
    ["package.json", "Package manifest"],
    ["package-lock.json", "Package lockfile"],
    ["node_modules", "Installed Node.js dependencies"],
    [path.join("installers", dependencies[0]), "Node.js MSI"],
    [path.join("installers", dependencies[1]), "PostgreSQL installer"]
  ];

  for (const [relativePath, label] of requiredFiles) {
    await requireFile(path.join(projectDir, relativePath), label);
  }
  if (!(await stat(path.join(projectDir, "node_modules"))).isDirectory()) {
    throw new Error("node_modules must be a directory. Run npm ci before building.");
  }

  let compiler;
  for (const candidate of innoPaths()) {
    try {
      await access(candidate);
      compiler = candidate;
      break;
    } catch {}
  }
  if (!compiler) {
    throw new Error("Inno Setup 6 was not found. Install it or set the ISCC environment variable to ISCC.exe.");
  }
  await mkdir(outputDir, { recursive: true });

  const buildDir = await mkdtemp(path.join(os.tmpdir(), "hardwareops-installer-"));
  try {
    await writeFile(path.join(buildDir, "provision.ps1"), psProvisioner(), "utf8");
    await writeFile(path.join(buildDir, "start.ps1"), appLauncher(), "utf8");
    const iconPath = path.join(projectDir, "assets", "app.ico");
    let useIcon = false;
    try {
      await access(iconPath);
      useIcon = true;
    } catch {}

    const issPath = path.join(buildDir, "hardwareops.iss");
    await writeFile(issPath, installerDefinition({
      projectDir,
      outputDir,
      buildDir,
      version: packageJson.version,
      iconPath: useIcon ? iconPath : ""
    }), "utf8");

    const { stdout, stderr } = await execFileAsync(compiler, ["/Qp", issPath], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    if (stdout.trim()) process.stdout.write(stdout);
    if (stderr.trim()) process.stderr.write(stderr);
    const outputFile = path.join(outputDir, `HardwareOps-Setup-${packageJson.version}.exe`);
    await requireFile(outputFile, "Compiled installer");
    console.log(`Created ${outputFile}`);
    console.log(`Bundled prerequisites from ${installersDir}`);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`Installer build failed: ${error.message}`);
  process.exitCode = 1;
});
