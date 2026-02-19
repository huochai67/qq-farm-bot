/**
 * Code 管理模块 - 保存/读取/删除登录code
 */

const fs = require('fs');
const path = require('path');

const CODE_FILE = path.join(__dirname, '..', '.farmcode');

/**
 * 保存 code 到本地文件
 * @param {string} code 登录code
 */
function saveCode(code) {
    try {
        fs.writeFileSync(CODE_FILE, code, 'utf8');
    } catch (err) {
        console.warn('[Code管理] 保存code失败:', err.message);
    }
}

/**
 * 从本地文件读取 code
 * @returns {string|null} code 或 null
 */
function loadCode() {
    try {
        if (fs.existsSync(CODE_FILE)) {
            const code = fs.readFileSync(CODE_FILE, 'utf8').trim();
            return code || null;
        }
    } catch (err) {
        console.warn('[Code管理] 读取code失败:', err.message);
    }
    return null;
}

/**
 * 删除本地保存的 code
 */
function deleteCode() {
    try {
        if (fs.existsSync(CODE_FILE)) {
            fs.unlinkSync(CODE_FILE);
        }
    } catch (err) {
        console.warn('[Code管理] 删除code失败:', err.message);
    }
}

module.exports = {
    saveCode,
    loadCode,
    deleteCode,
};
