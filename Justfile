@_list:
  {{just_executable()}} --justfile {{source_file()}} --list --unsorted

package:
  npm ci
  npm run package

release:
  ./release.sh

publish-vscode vsix:
  npm ci
  npm run publish:vsce -- --packagePath "{{vsix}}" -p "$VSCE_PAT"

publish-open-vsx vsix:
  npm ci
  npm run publish:open-vsx -- "{{vsix}}" -p "$OVSX_PAT"
