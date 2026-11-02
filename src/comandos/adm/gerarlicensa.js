const config = require('../../../data/config.json');
const { isOwnerCheck } = require('../../utils/baileys');
const crypto = require('crypto');
const { licencasStore } = require('../../utils/firebaseDataLayer');

function parseDuracaoEGrupo(args) {
    if (!args || args.length === 0) return { tempo: null, indexGrupo: null, displayTempo: '' };

    const fullStr = args.join(' ').trim();

    if (/^(perm|permanente|vitalicio|vitalícia)$/i.test(fullStr)) {
        return { tempo: 'permanente', indexGrupo: null, displayTempo: 'Vitalício' };
    }

    const matchTempoUnico = fullStr.match(/^(\d+)\s*(s|seg|segundo|segundos|min|minuto|minutos|h|hora|horas|d|dia|dias|mes|meses|a|ano|anos)?$/i);
    if (matchTempoUnico) {
        const val = parseInt(matchTempoUnico[1]);
        const unit = (matchTempoUnico[2] || 'd').toLowerCase();
        let display = `${val} ${unit}`;
        if (['d', 'dia', 'dias'].includes(unit)) display = `${val} dia(s)`;
        else if (['h', 'hora', 'horas'].includes(unit)) display = `${val} hora(s)`;
        else if (['min', 'minuto', 'minutos'].includes(unit)) display = `${val} minuto(s)`;
        else if (['mes', 'meses'].includes(unit)) display = `${val} mês(es)`;
        else if (['ano', 'anos', 'a'].includes(unit)) display = `${val} ano(s)`;

        return { tempo: `${val}${unit}`, indexGrupo: null, displayTempo: display };
    }

    let indexGrupo = null;
    let tempoResto = '';

    if (args[0].toLowerCase() === 'grupo' || args[0].toLowerCase() === 'g' || args[0].startsWith('#')) {
        indexGrupo = parseInt(args[0].replace(/\D/g, '') || args[1]);
        tempoResto = args.slice(args[0].startsWith('#') ? 1 : 2).join(' ');
    } else if (args.length >= 2 && /^\d+$/.test(args[0])) {
        const resto = args.slice(1).join(' ').trim();
        const matchResto = resto.match(/^(\d+)\s*(s|seg|segundo|segundos|min|minuto|minutos|h|hora|horas|d|dia|dias|mes|meses|a|ano|anos)?$/i) || /^(perm|permanente|vitalicio)$/i.test(resto);
        if (matchResto) {
            indexGrupo = parseInt(args[0]);
            tempoResto = resto;
        }
    }

    if (indexGrupo !== null && tempoResto) {
        if (/^(perm|permanente|vitalicio)$/i.test(tempoResto)) {
            return { tempo: 'permanente', indexGrupo, displayTempo: 'Vitalício' };
        }
        const matchT = tempoResto.match(/^(\d+)\s*(s|seg|segundo|segundos|min|minuto|minutos|h|hora|horas|d|dia|dias|mes|meses|a|ano|anos)?$/i);
        if (matchT) {
            const val = parseInt(matchT[1]);
            const unit = (matchT[2] || 'd').toLowerCase();
            let display = `${val} ${unit}`;
            if (['d', 'dia', 'dias'].includes(unit)) display = `${val} dia(s)`;
            else if (['h', 'hora', 'horas'].includes(unit)) display = `${val} hora(s)`;
            else if (['min', 'minuto', 'minutos'].includes(unit)) display = `${val} minuto(s)`;
            else if (['mes', 'meses'].includes(unit)) display = `${val} mês(es)`;
            return { tempo: `${val}${unit}`, indexGrupo, displayTempo: display };
        }
    }

    return { tempo: fullStr, indexGrupo: null, displayTempo: fullStr };
}

module.exports = async (sock, msg, from, sender, text) => {
    const pfx = config.prefix || '.';
    const cleanLower = (text || '').trim().toLowerCase();
    const isGerar = cleanLower.startsWith(pfx + 'gerarlicensa') || cleanLower.startsWith(pfx + 'gerarlicenca');
    if (isGerar) {
        const isOwner = isOwnerCheck(sender, msg);
        if (!isOwner) return true;

        const args = text.trim().split(/\s+/).slice(1);

        const { tempo, indexGrupo, displayTempo } = parseDuracaoEGrupo(args);

        if (!tempo) {
            await sock.sendMessage(from, { text: '❌ *COMANDO INCORRETO*\n──────────────────\n▸ Informe a duração da licença.\n──────────────────\n▸ Exemplos:\n  • .gerarlicenca 24h\n  • .gerarlicenca 30d\n  • .gerarlicenca 31 dias\n  • .gerarlicenca permanente\n──────────────────\n▸ Para limitar a um grupo específico:\n  • .gerarlicenca grupo 2 30d\n  • .gerarlicenca 2 30d' }, { quoted: msg });
            return true;
        }

        let targetGroupId = null;
        let targetGroupName = '';

        if (indexGrupo !== null) {
            let mapaGrupos = global.mapaGrupos;
            if (!mapaGrupos || mapaGrupos.length === 0) {
                const configManager = require('../../utils/configManager');
                const groups = configManager.loadGroupConfig();
                mapaGrupos = Object.entries(groups)
                    .filter(([id, cfg]) => cfg.authorized)
                    .map(([id]) => id)
                    .sort((a, b) => a[0].localeCompare(b[0]));
                global.mapaGrupos = mapaGrupos;
            }

            if (indexGrupo < 1 || indexGrupo > mapaGrupos.length) {
                await sock.sendMessage(from, { text: `❌ *ERRO*\n──────────────────\n▸ Grupo *${indexGrupo}* fora da lista atual do *.grupos* (válido: 1 a ${mapaGrupos.length}).` }, { quoted: msg });
                return true;
            }

            targetGroupId = mapaGrupos[indexGrupo - 1];

            const { getGroupMetadataCached } = require('../../utils/baileys');
            try {
                const metadata = await getGroupMetadataCached(sock, targetGroupId);
                targetGroupName = metadata?.subject || 'Grupo';
            } catch (e) {
                targetGroupName = targetGroupId.split('@')[0];
            }
        }

        const code = 'SEVEN-' + crypto.randomBytes(2).toString('hex').toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

        let licencas = licencasStore.loadSync() || {};

        const now = Date.now();
        licencas[code] = {
            duracao: tempo,
            criadaEm: now,
            expiraEm: now + (24 * 60 * 60 * 1000)
        };

        if (targetGroupId) {
            licencas[code].grupoId = targetGroupId;
        }

        licencasStore.save(licencas);

        let restritoMsg = '';
        if (targetGroupId) {
            restritoMsg = `\n──────────────────\n🔒 *GRUPO RESTRITO*\n▸ 📛 *Grupo:* ${targetGroupName}\n▸ 🆔 *JID:* ${targetGroupId}\n▸ ⚠️ _Esta licença vale só para este grupo._\n`;
        }

        const txt = `✅ *LICENÇA CRIADA*\n──────────────────\n▸ 🔑 *Código:* ${code}\n▸ ⏱️ *Duração:* ${displayTempo || tempo}\n▸ ⏳ *Validade:* o código expira em 24h se não for usado.\n${restritoMsg}──────────────────\n📌 *COMO USAR*\n▸ Envie o código no grupo certo (é preciso ser Administrador do grupo).`;

        await sock.sendMessage(from, { text: txt }, { quoted: msg });
        return true;
    }
    return false;
};
