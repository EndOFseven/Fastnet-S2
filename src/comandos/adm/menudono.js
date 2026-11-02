const fs = require('fs');
const path = require('path');
const { isOwnerCheck } = require('../../utils/baileys.js');
const config = require('../../../data/config.json');

module.exports = async (sock, msg, from, sender, text) => {
    if (text === config.prefix + 'menudono') {
        const isOwner = isOwnerCheck(sender, msg);

        if (!isOwner) {
            await sock.sendMessage(from, { text: '❌ Acesso restrito ao dono principal do bot.' }, { quoted: msg });
            return true;
        }

        const prefix = config.prefix;
        const userName = msg.pushName || 'Dono';

        const header = [
            '🪐 *MENU DO DONO (MANUAL)* ',
            `Fala, ${userName}!`,
            '──────────────────'
        ].join('\n');

        const bloco1 = [
            '*👑 ADMINISTRAÇÃO GLOBAL (A-Z)*',
            '',
            `▸ ${prefix}off (Pausar Grupo)`,
            `▸ ${prefix}offall (Pausar Global)`,
            `▸ ${prefix}on (Reativar Grupo)`,
            `▸ ${prefix}onall (Reativar Global)`,
            `▸ ${prefix}prefixoglobal`,
            `▸ ${prefix}status`,
            `▸ ${prefix}subdono [add/remove]`,
            '──────────────────'
        ].join('\n');

        const bloco2 = [
            '*🔌 GRUPOS & PLANOS (A-Z)*',
            '',
            `▸ ${prefix}aluguel`,
            `▸ ${prefix}bcast`,
            `▸ ${prefix}delgrupo`,
            `▸ ${prefix}entrar`,
            `▸ ${prefix}grupoall`,
            `▸ ${prefix}grupos`,
            `▸ ${prefix}remover aluguel`,
            `▸ ${prefix}renovar`,
            `▸ ${prefix}sair`,
            '──────────────────'
        ].join('\n');

        const bloco3 = [
            '*🔑 LICENÇAS (A-Z)*',
            '',
            `▸ ${prefix}diminuirlicenca grupo [dias]`,
            `▸ ${prefix}gerarlicenca [dias]`,
            `▸ ${prefix}renovar`,
            '──────────────────'
        ].join('\n');

        const menuDonoText = [header, '', bloco1, '', bloco2, '', bloco3].join('\n');

        const logoPath = path.join(__dirname, '../../../assets', 'menuadm.jpg');

        if (fs.existsSync(logoPath)) {
            await sock.sendMessage(from, {
                image: fs.readFileSync(logoPath),
                caption: menuDonoText
            }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { text: menuDonoText }, { quoted: msg });
        }
        return true;
    }
    return false;
};
