const fs = require('fs');

const files = {
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/api-keys.ts': "import { NotFoundError } from '../errors/index';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/compliance.ts': "import { UnauthorizedError } from '../errors/index';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/digest.ts': "import { BadRequestError } from '../errors/index';\n",
  'C:/Users/ADMIN/SYNCRO/backend/src/routes/team.ts': "import { NotFoundError, BadRequestError } from '../errors/index';\n",
};

for (const [path, imp] of Object.entries(files)) {
  let c = fs.readFileSync(path, 'utf8');
  c = imp + c;
  fs.writeFileSync(path, c, 'utf8');
  const verify = fs.readFileSync(path, 'utf8').split('\n')[0];
  console.log(path.split('/').pop(), '-> line 1:', verify);
}
