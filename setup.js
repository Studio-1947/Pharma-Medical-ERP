const crypto = require('crypto');
const fs = require('fs');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

let env = fs.readFileSync('.env.example', 'utf8');

// replace newlines with \n literal for env file
const priv = privateKey.replace(/\n/g, '\\n');
const pub = publicKey.replace(/\n/g, '\\n');

env = env.replace(/JWT_PRIVATE_KEY=".*?"/, `JWT_PRIVATE_KEY="${priv}"`);
env = env.replace(/JWT_PUBLIC_KEY=".*?"/, `JWT_PUBLIC_KEY="${pub}"`);

fs.writeFileSync('.env', env);
console.log('.env created successfully.');
