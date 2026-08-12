const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const host = read('Host.cs');
const build = read('Build.ps1');
const packager = read('Create-UpdatePackage.ps1');
const links = read('app/external-overlay-links.js');
const settings = read('app/websocket-diagnose.html');

assert(host.includes('EnsureHtmlOverlayFolder(contentRoot)'), 'Host must prepare Content/html-overlays on every start');
assert(host.includes('WriteEmbeddedResourceIfMissing'), 'Host must restore the neutral help files for update users');
assert(host.includes('return Normalize(Path.Combine(baseDir, "Content"), baseDir);'), 'First start must support a missing Content folder');
assert(build.includes('FreakShow.HtmlOverlays.Readme'), 'README must be embedded in FreakShow.exe');
assert(build.includes('FreakShow.HtmlOverlays.LinkTemplate'), 'URL template must be embedded in FreakShow.exe');
assert(packager.includes("'Content\\html-overlays'"), 'Full package must contain the HTML overlay starter folder');
assert(fs.existsSync(path.join(root, 'Content', 'html-overlays', 'README-FIRST.txt')), 'HTML overlay README is missing');
assert(fs.existsSync(path.join(root, 'Content', 'html-overlays', 'overlay-link-template.txt')), 'HTML overlay URL template is missing');
assert(links.includes('isStreamUpHorizontalChat'), 'StreamUP Horizontal Chat must use the FreakShow relay');
assert(settings.includes("/streamup-horizontalchat\\.html$/i"), 'StreamUP preview must use the FreakShow relay');

console.log('html-overlays-folder.test.js: OK');
