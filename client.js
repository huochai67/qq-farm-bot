/**
 * QQ经典农场 挂机脚本 - 入口文件
 *
 * 模块结构:
 *   src/config.js       - 配置常量与枚举
 *   src/utils.js        - 通用工具函数
 *   src/proto.js        - Protobuf 加载与类型管理
 *   src/network.js      - WebSocket 连接/消息编解码/登录/心跳
 *   src/codeManager.js  - Code 本地保存/读取/删除
 *   src/farm.js         - 自己农场操作与巡田循环
 *   src/friend.js       - 好友农场操作与巡查循环
 *   src/decode.js       - PB解码/验证工具模式
 */

const { CONFIG } = require('./src/config');
const { loadProto } = require('./src/proto');
const { connect, cleanup, getWs } = require('./src/network');
const { startFarmCheckLoop, stopFarmCheckLoop } = require('./src/farm');
const { startFriendCheckLoop, stopFriendCheckLoop } = require('./src/friend');
const { initTaskSystem, cleanupTaskSystem } = require('./src/task');
const { initStatusBar, cleanupStatusBar, setStatusPlatform } = require('./src/status');
const { startSellLoop, stopSellLoop, debugSellFruits } = require('./src/warehouse');
const { processInviteCodes } = require('./src/invite');
const { verifyMode, decodeMode } = require('./src/decode');
const { emitRuntimeHint, sleep } = require('./src/utils');
const { getQQFarmCodeByScan } = require('./src/qqQrLogin');
const { initFileLogger } = require('./src/logger');
const { saveCode, loadCode, deleteCode } = require('./src/codeManager');

initFileLogger();

// ============ 帮助信息 ============
function showHelp() {
    console.log(`
QQ经典农场 挂机脚本
====================

用法:
  node client.js --code <登录code> [--wx] [--interval <秒>] [--friend-interval <秒>]
  node client.js --qr [--interval <秒>] [--friend-interval <秒>]
  node client.js --verify
  node client.js --decode <数据> [--hex] [--gate] [--type <消息类型>]

命令行参数:
  --code              小程序 login() 返回的临时凭证 (必需)
  --qr                启动后使用QQ扫码获取登录code（仅QQ平台）
  --wx                使用微信登录 (默认为QQ小程序)
  --qq                使用QQ登录 (默认值)
  --interval          自己农场巡查完成后等待秒数, 默认10秒, 最低1秒
  --friend-interval   好友巡查完成后等待秒数, 默认1秒, 最低1秒
  --verify            验证proto定义
  --decode            解码PB数据 (运行 --decode 无参数查看详细帮助)

环境变量 (优先级: 命令行参数 > 环境变量 > 默认值):
  CODE                登录凭证，等同于 --code
  PLATFORM            平台选择 'qq' 或 'wx'，等同于 --qq 或 --wx
  QR_LOGIN            设为 'true' 启用扫码登录，等同于 --qr
  INTERVAL            自己农场巡查间隔，等同于 --interval
  FRIEND_INTERVAL     好友查巡间隔，等同于 --friend-interval

功能:
  - 自动收获成熟作物 → 购买种子 → 种植 → 施肥
  - 自动除草、除虫、浇水
  - 自动铲除枯死作物
  - 自动巡查好友农场: 帮忙浇水/除草/除虫 + 偷菜
  - 自动领取任务奖励 (支持分享翻倍)
  - 每分钟自动出售仓库果实
  - 启动时读取 share.txt 处理邀请码 (仅微信)
  - 心跳保活
  - 自动保存登录code: 扫码成功后自动保存到本地
  - 优先使用旧code登录: 下次启动时若无 --code 参数会优先尝试使用保存的旧code，失败后自动重新扫码

邀请码文件 (share.txt):
  每行一个邀请链接，格式: ?uid=xxx&openid=xxx&share_source=xxx&doc_id=xxx
  启动时会尝试通过 SyncAll API 同步这些好友

本地文件 (.farmcode):
  自动保存的登录code，程序会使用此文件优先登录而无需重复扫码

示例:
  # 通过命令行参数启动
  node client.js --code abc123 --interval 15 --friend-interval 2

  # 通过环境变量启动
  CODE=abc123 INTERVAL=15 FRIEND_INTERVAL=2 node client.js

  # 混合用法 (命令行参数优先)
  CODE=abc123 node client.js --interval 20

  # QQ平台扫码登录，code自动保存，下次无需传参
  node client.js
`);
}

function getArgsMap(args) {
    const map = new Map();

    for (let i = 0; i < args.length; i++) {
        const key = args[i];
        if (!key.startsWith('--')) {
            map.set(key, true);
            continue;
        }

        if (i >= (args.length - 1)) {
            break;
        }

        const value = args[++i];
        if (value === undefined || value.startsWith('--')) {
            continue;
        }

        map.set(key, value);
    }

    return map;
}

function parseArgs(argsMap) {
    // 优先级：命令行参数 > 环境变量 > 默认值
    const options = {
        code: '',
        qrLogin: false
    };

    // 1. 首先从环境变量读取
    if (process.env.CODE) {
        options.code = process.env.CODE;
    }
    if (process.env.PLATFORM && ['qq', 'wx'].includes(process.env.PLATFORM)) {
        CONFIG.platform = process.env.PLATFORM;
    }
    if (process.env.QR_LOGIN === 'true') {
        options.qrLogin = true;
    }

    let interval = parseInt(process.env.INTERVAL) || 0;
    let friend_interval = parseInt(process.env.FRIEND_INTERVAL) || 0;

    // 2. 然后用命令行参数覆盖环境变量
    for (const [key, value] of argsMap) {
        switch (key) {
            case '--code':
                options.code = value;
                break;
            case '--qr':
                options.qrLogin = value === true || value === 'true';
                break;
            case '--wx':
                CONFIG.platform = 'wx';
                break;
            case '--qq':
                CONFIG.platform = 'qq';
                break;
            case '--interval':
                interval = parseInt(value);
                break;
            case '--friend-interval':
                friend_interval = parseInt(value);
                break;
        }
    }

    if (interval) {
        CONFIG.farmCheckInterval = Math.max(interval, 1) * 1000;
    }

    if (friend_interval) {
        CONFIG.friendCheckInterval = Math.max(friend_interval, 1) * 1000;
    }

    return options;
}

// ============ 主函数 ============
async function main() {
    const args = process.argv.slice(2);
    let usedQrLogin = false;

    // 加载 proto 定义
    await loadProto();

    // 验证模式
    if (args.includes('--verify')) {
        await verifyMode();
        return;
    }

    // 解码模式
    if (args.includes('--decode')) {
        await decodeMode(args);
        return;
    }

    // 正常挂机模式
    const argsMap = getArgsMap(args);
    const options = parseArgs(argsMap);

    // 尝试使用已保存的 code，如果没有传入 --code 参数
    if (!options.code && CONFIG.platform === 'qq') {
        const savedCode = loadCode();
        if (savedCode) {
            console.log('[Code管理] 检测到已保存的code，将优先尝试使用旧code登录');
            options.code = savedCode;
            options.useSavedCode = true;
        }
    }

    // 如果仍然没有 code，尝试使用扫码登录
    if (!options.code && CONFIG.platform === 'qq' && (options.qrLogin || !args.includes('--code'))) {
        console.log('[扫码登录] 正在获取二维码...');
        options.code = await getQQFarmCodeByScan();
        usedQrLogin = true;
        console.log(`[扫码登录] 获取成功，code=${options.code.substring(0, 8)}...`);
        // 保存新扫描得到的 code
        saveCode(options.code);
    }

    if (!options.code) {
        if (CONFIG.platform === 'wx') {
            console.log('[参数] 微信模式仍需通过 --code 传入登录凭证');
        }
        showHelp();
        process.exit(1);
    }
    if (options.deleteAccountMode && (!options.name || !options.certId)) {
        console.log('[参数] 注销账号模式必须提供 --name 和 --cert-id');
        showHelp();
        process.exit(1);
    }

    // 扫码阶段结束后清屏，避免状态栏覆盖二维码区域导致界面混乱
    if (usedQrLogin && process.stdout.isTTY) {
        process.stdout.write('\x1b[2J\x1b[H');
    }

    // 初始化状态栏
    initStatusBar();
    setStatusPlatform(CONFIG.platform);
    emitRuntimeHint(true);

    const platformName = CONFIG.platform === 'wx' ? '微信' : 'QQ';
    console.log(`[启动] ${platformName} code=${options.code.substring(0, 8)}... 农场${CONFIG.farmCheckInterval / 1000}s 好友${CONFIG.friendCheckInterval / 1000}s`);

    // 连接并登录，登录成功后启动各功能模块
    let loginAttemptCount = 0;
    const onLoginSuccess = async () => {
        // 登录成功，保存 code
        if (options.useSavedCode) {
            // 旧 code 仍然有效，保留即可
        }

        // 处理邀请码 (仅微信环境)
        await processInviteCodes();

        startFarmCheckLoop();

        // 判定是否启动好友巡查
        if (CONFIG.farmCheckInterval > 0) {
            startFriendCheckLoop();
        }
        initTaskSystem();

        // 启动时立即检查一次背包
        setTimeout(() => debugSellFruits(), 5000);
        startSellLoop(60000);  // 每分钟自动出售仓库果实
    };

    const onLoginError = async (err) => {
        loginAttemptCount++;
        console.log(`[登录] 失败: ${err.message}`);

        // 如果是使用旧 code 登录失败，删除旧 code 并重新扫码
        if (options.useSavedCode && loginAttemptCount === 1) {
            console.log('[Code管理] 旧code已失效，正在删除...');
            deleteCode();

            // 等待一下之前的连接完全关闭
            await sleep(1000);

            if (CONFIG.platform === 'qq') {
                console.log('[扫码登录] 正在重新获取二维码...');
                try {
                    options.code = await getQQFarmCodeByScan();
                    console.log(`[扫码登录] 获取成功，code=${options.code.substring(0, 8)}...`);
                    saveCode(options.code);
                    options.useSavedCode = false;

                    // 清屏
                    if (process.stdout.isTTY) {
                        process.stdout.write('\x1b[2J\x1b[H');
                    }

                    // 重新连接
                    console.log('[启动] QQ code=' + options.code.substring(0, 8) + '... 农场' + CONFIG.farmCheckInterval / 1000 + 's 好友' + CONFIG.friendCheckInterval / 1000 + 's');
                    connect(options.code, onLoginSuccess, onLoginError);
                } catch (scanErr) {
                    console.error('[扫码登录] 失败:', scanErr.message);
                    process.exit(1);
                }
            }
        } else {
            // 其他原因导致的登录失败，直接退出
            console.log('[登录] 无法恢复，退出程序');
            process.exit(1);
        }
    };

    connect(options.code, onLoginSuccess, onLoginError);

    // 退出处理
    process.on('SIGINT', () => {
        cleanupStatusBar();
        console.log('\n[退出] 正在断开...');
        stopFarmCheckLoop();
        stopFriendCheckLoop();
        cleanupTaskSystem();
        stopSellLoop();
        cleanup();
        const ws = getWs();
        if (ws) ws.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});