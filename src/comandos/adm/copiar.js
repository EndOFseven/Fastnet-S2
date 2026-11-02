const config = require('../../../data/config.json')
const { isAdmin: checkIsAdmin, isOwnerCheck } = require('../../utils/baileys')
const configManager = require('../../utils/configManager')
const { copyNanoCommands, copyNanosCommands } = require('../../bot/nano')

module.exports = async (sock, msg, from, sender, text) => {
    const lower = text.toLowerCase().trim()
    const prefix = config.prefix

    const cmdNano = prefix + 'copiarnano'
    const cmdNanos = prefix + 'copiarnanos'
    const cmdProtecoes = prefix + 'copiarprotecoes'
    const cmdConfig = prefix + 'copiarconfiguracoes'

    if (!lower.startsWith(cmdNano) && !lower.startsWith(cmdNanos) && !lower.startsWith(cmdProtecoes) && !lower.startsWith(cmdConfig)) {
        return false
    }

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Este comando é exclusivo de grupos.' }, { quoted: msg })
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    const isAdminUser = await checkIsAdmin(sock, from, sender)
    if (!isOwner && !isAdminUser) {
        await sock.sendMessage(from, { text: '❌ Só administradores podem usar os comandos de clone.' }, { quoted: msg })
        return true
    }

    let sourceId = text.split(' ').slice(1).join(' ').trim()
    if (!sourceId) {
        await sock.sendMessage(from, { text: `❌ *COMANDO INCORRETO*\n──────────────────\n▸ Informe o ID do grupo de origem.\n▸ Exemplo: \`${lower.split(' ')[0]} 120363xxxxxx@g.us\`\n──────────────────\n▸ 💡 Pegue o ID do grupo com o comando \`.infogp\` nele.` }, { quoted: msg })
        return true
    }

    if (!sourceId.includes('@')) {
        sourceId = sourceId.replace(/\D/g, '') + '@g.us'
    }

    if (lower.startsWith(cmdNano) && !lower.startsWith(cmdNanos)) {
        const qtd = copyNanoCommands(sourceId, from)
        if (qtd === 0) {
            await sock.sendMessage(from, { text: `⚠️ *AVISO*\n──────────────────\n▸ Não há comandos NANO no grupo de origem (\`${sourceId}\`).` }, { quoted: msg })
        } else {
            await sock.sendMessage(from, {
                text: `✅ *NANO COMANDOS COPIADOS*\n──────────────────\n▸ 📌 *Origem:* \`${sourceId}\`\n▸ 📥 *Total copiado:* ${qtd} nano comandos aplicados neste grupo.`
            }, { quoted: msg })
        }
        return true
    }

    if (lower.startsWith(cmdNanos)) {
        const qtd = copyNanosCommands(sourceId, from)
        if (qtd === 0) {
            await sock.sendMessage(from, { text: `⚠️ *AVISO*\n──────────────────\n▸ Não há comandos NANOS no grupo de origem (\`${sourceId}\`).` }, { quoted: msg })
        } else {
            await sock.sendMessage(from, {
                text: `✅ *NANOS COMANDOS COPIADOS*\n──────────────────\n▸ 📌 *Origem:* \`${sourceId}\`\n▸ 📥 *Total copiado:* ${qtd} nanos comandos aplicados neste grupo.`
            }, { quoted: msg })
        }
        return true
    }

    if (lower.startsWith(cmdProtecoes)) {
        const allConfigs = configManager.loadGroupConfig()
        const sourceCfg = allConfigs[sourceId]

        if (!sourceCfg) {
            await sock.sendMessage(from, { text: `⚠️ *AVISO*\n──────────────────\n▸ O grupo de origem (\`${sourceId}\`) não tem configuração salva.` }, { quoted: msg })
            return true
        }

        if (!allConfigs[from]) allConfigs[from] = {}
        const targetCfg = allConfigs[from]

        const protecoesKeys = [
            'antiLink', 'antiStatus', 'antiGringo', 'antiPalavrao',
            'antiTrava', 'antiFake', 'antiFlood', 'antiBotClone',
            'botDesligado', 'anticoncorrencia'
        ]

        let copiados = 0
        for (const key of protecoesKeys) {
            if (typeof sourceCfg[key] === 'boolean') {
                targetCfg[key] = sourceCfg[key]
                copiados++
            }
        }

        configManager.saveGroupConfig(true)

        await sock.sendMessage(from, {
            text: `✅ *PROTEÇÕES COPIADAS*\n──────────────────\n▸ 📌 *Origem:* \`${sourceId}\`\n▸ 🛡️ *Resultado:* ${copiados} proteções ON/OFF sincronizadas neste grupo.\n──────────────────\n▸ ⚠️ *Nota:* listas de concorrentes e termos personalizados foram mantidos como estavam.`
        }, { quoted: msg })
        return true
    }

    if (lower.startsWith(cmdConfig)) {
        const allConfigs = configManager.loadGroupConfig()
        const sourceCfg = allConfigs[sourceId]

        if (!sourceCfg) {
            await sock.sendMessage(from, { text: `⚠️ *AVISO*\n──────────────────\n▸ O grupo de origem (\`${sourceId}\`) não tem configuração salva.` }, { quoted: msg })
            return true
        }

        if (!allConfigs[from]) allConfigs[from] = {}
        const targetCfg = allConfigs[from]

        const configKeys = [
            'bemVindoAtivo', 'somenteAdmins', 'botDesligado', 'horaAbrir', 'horaFechar'
        ]

        let copiados = 0
        for (const key of configKeys) {
            if (sourceCfg[key] !== undefined && typeof sourceCfg[key] !== 'object') {
                targetCfg[key] = sourceCfg[key]
                copiados++
            }
        }

        configManager.saveGroupConfig(true)

        await sock.sendMessage(from, {
            text: `✅ *CONFIGURAÇÕES COPIADAS*\n──────────────────\n▸ 📌 *Origem:* \`${sourceId}\`\n▸ ⚙️ *Resultado:* ${copiados} ajustes e horários aplicados neste grupo.\n──────────────────\n▸ ⚠️ *Nota:* prazos de expiração e licenças individuais do grupo foram mantidos.`
        }, { quoted: msg })
        return true
    }

    return false
}
