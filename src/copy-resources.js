const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, 'src', 'resources');
const destination = path.join(__dirname, 'dist');

function copyFolderSync(src, dest) {
    if (!fs.existsSync(src)) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

    fs.readdirSync(src).forEach((item) => {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);

        if (fs.lstatSync(srcPath).isDirectory()) {
            copyFolderSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    });
}

copyFolderSync(source, destination);