// Injects the real screenshots into the round fragment (keeps the source readable).
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, '01-source.txt'), 'utf8').replace(/\r\n/g, '\n');
const out = src.replace(/\{\{img:(\w+)\}\}/g, (_, n) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, 'shots', n + '.jpg')).toString('base64'));
fs.mkdirSync(path.join(dir, 'rounds'), { recursive: true });
fs.writeFileSync(path.join(dir, 'rounds', '01.html'), out);
