require('dotenv').config();
const { handleLogin } = require('./api/netlify-functions/auth'); // adjust path as needed

(async () => {
    try {
        const result = await handleLogin({ email: 'mubashersultanmehmood@gmail.com', password: '1234567890' });
        console.log(result);
    } catch (err) {
        console.error(err);
    }
})();
