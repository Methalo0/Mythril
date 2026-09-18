// Mythril MSI builder — generates a WiX source for the packaged app and
// compiles it with the cached candle/light toolchain (no heat needed).
// Usage: node build-msi.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const APP_DIR = path.join(ROOT, 'out', 'Mythril-win32-x64')
const OUT_DIR = path.join(ROOT, 'release')
const WIX_DIR = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'wix-4.0.0.5512.2', 'wix-4.0.0.5512.2-1xm13')
const VERSION = '0.2.0'

if (!fs.existsSync(path.join(APP_DIR, 'mythril.exe'))) {
  console.error('Packaged app not found — run electron-forge package first')
  process.exit(1)
}
fs.mkdirSync(OUT_DIR, { recursive: true })

// Stable component/file ids derived from the relative path.
const seen = new Set()
function id(prefix, rel) {
  let h = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 32)
  let candidate = `${prefix}${h}`
  while (seen.has(candidate)) candidate = `${candidate}x`
  seen.add(candidate)
  return candidate
}

const files = []
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else files.push(path.relative(APP_DIR, full))
  }
}
walk(APP_DIR)
console.log(`Harvesting ${files.length} files…`)

// --- proper tree build ---
const dirs = new Map() // relDir -> [{name, abs}]
for (const rel of files) {
  const d = path.dirname(rel)
  if (!dirs.has(d)) dirs.set(d, [])
  dirs.get(d).push(rel)
}

function dirXml(relDir) {
  const parts = relDir === '.' ? [] : rel.split(path.sep)
  return parts
}

// Build directory tree XML recursively.
function buildDirTree() {
  const root = { name: null, children: new Map(), files: [] }
  for (const rel of files) {
    const parts = rel.split(path.sep)
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.children.has(parts[i])) node.children.set(parts[i], { name: parts[i], children: new Map(), files: [] })
      node = node.children.get(parts[i])
    }
    node.files.push(rel)
  }
  const compXml = []
  function emit(node, indent) {
    let inner = ''
    for (const f of node.files) {
      const abs = path.join(APP_DIR, f).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      const cid = id('c', f)
      const fid = f === 'mythril.exe' ? 'mainExecutable' : id('f', f)
      inner += `${indent}<Component Id="${cid}" Guid="*">\n${indent}  <File Id="${fid}" Source="${abs}" />\n${indent}</Component>\n`
      compXml.push(cid)
    }
    for (const [, child] of node.children) {
      inner += `${indent}<Directory Id="${id('d', child.name + Math.random())}" Name="${child.name.replace(/&/g, '&amp;')}">\n${emit(child, indent + '  ')}${indent}</Directory>\n`
    }
    return inner
  }
  return { body: emit(root, '          '), compXml }
}

const { body, compXml } = buildDirTree()
const wxs2 = `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Product Id="*" Name="Mythril" Language="1033" Version="${VERSION}" Manufacturer="MetHalo11885260" UpgradeCode="b7f3a1c2-4d5e-4f6a-9b8c-1d2e3f4a5b6c">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="perUser" />
    <MajorUpgrade DowngradeErrorMessage="A newer version of Mythril is already installed." />
    <Media Id="1" Cabinet="mythril.cab" EmbedCab="yes" />
    <Icon Id="MythrilIcon.exe" SourceFile="${path.join(ROOT, 'icons', 'icon.ico')}" />
    <Property Id="ARPPRODUCTICON" Value="MythrilIcon.exe" />
    <UIRef Id="WixUI_InstallDir" />
    <Property Id="WIXUI_INSTALLDIR" Value="INSTALLFOLDER" />
    <Feature Id="Main" Title="Mythril" Level="1">
${compXml.map(c => `      <ComponentRef Id="${c}" />`).join('\n')}
      <ComponentRef Id="Shortcuts" />
    </Feature>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="DesktopFolder" />
      <Directory Id="ProgramMenuFolder" />
      <Directory Id="LocalAppDataFolder">
        <Directory Id="INSTALLFOLDER" Name="Mythril">
${body}
          <Component Id="Shortcuts" Guid="9c1a2b3c-4d5e-4f6a-8b9c-0d1e2f3a4b5c">
            <Shortcut Id="DesktopShortcut" Name="Mythril" Target="[#mainExecutable]" WorkingDirectory="INSTALLFOLDER" Directory="DesktopFolder" Icon="MythrilIcon.exe" />
            <Shortcut Id="StartMenuShortcut" Name="Mythril" Target="[#mainExecutable]" WorkingDirectory="INSTALLFOLDER" Directory="ProgramMenuFolder" Icon="MythrilIcon.exe" />
            <RegistryValue Root="HKCU" Key="Software\\MetHalo11885260\\Mythril" Name="installed" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>
    </Directory>
  </Product>
</Wix>
`

const wxsPath = path.join(OUT_DIR, 'mythril.wxs')
fs.writeFileSync(wxsPath, wxs2)
console.log('Wrote', wxsPath)

const objPath = path.join(OUT_DIR, 'mythril.wixobj')
const msiPath = path.join(OUT_DIR, `Mythril-${VERSION}.msi`)
execFileSync(path.join(WIX_DIR, 'candle.exe'), ['-nologo', '-arch', 'x64', '-ext', path.join(WIX_DIR, 'WixUIExtension.dll'), '-out', objPath, wxsPath], { stdio: 'inherit' })
execFileSync(path.join(WIX_DIR, 'light.exe'), ['-nologo', '-ext', path.join(WIX_DIR, 'WixUIExtension.dll'), '-sval', '-spdb', '-out', msiPath, objPath], { stdio: 'inherit' })
console.log('MSI built:', msiPath)
