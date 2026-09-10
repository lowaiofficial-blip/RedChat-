const fs = require('fs');
let content = fs.readFileSync('src/services/imageUploadService.ts', 'utf8');

content = content.replace("reader.readAsDataURL(file);\n  });\n}\n}", "reader.readAsDataURL(file);\n  });\n}");

fs.writeFileSync('src/services/imageUploadService.ts', content);
