const sharp = require('sharp');
const path = require('path');

const input = path.join(__dirname, 'media', 'lemon.svg');
const output = path.join(__dirname, 'media', 'lemon.png');

sharp(input)
    .resize(128, 128)
    .png()
    .toFile(output)
    .then(() => console.log('Successfully converted SVG to PNG'))
    .catch(err => {
        console.error('Error converting icon:', err);
        process.exit(1);
    });