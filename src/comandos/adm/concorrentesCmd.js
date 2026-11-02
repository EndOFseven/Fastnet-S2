const config = require('../../../data/config.json')
const configManager = require('../../utils/configManager')
const { isAdmin, isOwnerCheck, isLeaderCheck, getGroupMetadataCached } = require('../../utils/baileys')
const { concorrentesStore } = require('../../utils/firebaseDataLayer')

if (!global.concorrentesMapeados) {
    global.concorrentesMapeados = {}
}

async function coletarAdminsDeOutrosGrupos(sock, currentGroupId) {
    const groupConfig = configManager.loadGroupConfig()
    let allGroups = {}
    try {
        allGroups = await sock.groupFetchAllParticipating()
    } catch {
        allGroups = groupConfig
    }

    const otherGroupIds = Object.keys(allGroups).filter(id => id.endsWith('@g.us') && id !== currentGroupId)
    const adminMap = new Map()

    for (const otherGid of otherGroupIds) {
        const dotGid = otherGid.replace(/\./g, '___dot___')
        const gInfo = groupConfig[otherGid] || groupConfig[dotGid]
        if (gInfo && gInfo.authorized === false) {
            continue
        }

        let otherMeta = allGroups[otherGid]
        if (!otherMeta || !otherMeta.participants) {
            try {
                otherMeta = await getGroupMetadataCached(sock, otherGid)
            } catch {
                continue
            }
        }

        if (!otherMeta || !otherMeta.participants) continue

        const otherGroupName = otherMeta.subject || 'Outro Grupo'
        const otherAdmins = otherMeta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin')

        for (const adminP of otherAdmins) {
            const adminId = adminP.id || ''
            const adminNum = adminId.split('@')[0].split(':')[0].replace(/\D/g, '')
            if (!adminNum) continue

            if (isLeaderCheck(adminId) || isOwnerCheck(adminId)) continue

            if (!adminMap.has(adminNum)) {
                adminMap.set(adminNum, {
                    id: adminId,
                    numero: adminNum,
                    grupos: [otherGroupName],
                    gruposIds: [otherGid]
                })
            } else {
                const entry = adminMap.get(adminNum)
                if (!entry.grupos.includes(otherGroupName)) {
                    entry.grupos.push(otherGroupName)
                    entry.gruposIds.push(otherGid)
                }
            }
        }
    }

    return adminMap
}

module.exports = async function (sock, msg, from, sender, text) {
    const rawTokens = text.trim().split(/\s+/)
    const rawCmd = rawTokens[0].toLowerCase()
    const prefix = config.prefix

    const isAnticoncorrenciaMenu = (
        rawCmd === prefix + 'anticoncorrencia' ||
        rawCmd === prefix + 'anticoncorrentes' ||
        rawCmd === prefix + 'concorrentes' && rawTokens.length === 1 ||
        rawCmd === prefix + 'concorrente' && rawTokens.length === 1
    )

    const isMapCmd = (
        rawCmd === prefix + 'mapearconcorrentes' ||
        rawCmd === prefix + 'mapearconcorrente' ||
        rawCmd === prefix + 'mapconcorrentes'
    )

    const isPermitirCmd = (
        rawCmd === prefix + 'concorrente' && (rawTokens[1] === 'permitir' || rawTokens[1] === 'perdoar' || rawTokens[1] === 'whitelist') ||
        rawCmd === prefix + 'anticoncorrencia' && (rawTokens[1] === 'permitir' || rawTokens[1] === 'perdoar' || rawTokens[1] === 'whitelist')
    )

    const isProibirCmd = (
        rawCmd === prefix + 'concorrente' && (rawTokens[1] === 'proibir' || rawTokens[1] === 'bloquear' || rawTokens[1] === 'del') ||
        rawCmd === prefix + 'anticoncorrencia' && (rawTokens[1] === 'proibir' || rawTokens[1] === 'bloquear' || rawTokens[1] === 'del')
    )

    const isAddManualCmd = (
        rawCmd === prefix + 'concorrente' && (rawTokens[1] === 'add' || rawTokens[1] === 'adicionar') ||
        rawCmd === prefix + 'anticoncorrencia' && (rawTokens[1] === 'add' || rawTokens[1] === 'adicionar')
    )

    const isActionCmd = (
        (rawCmd === prefix + 'anticoncorrentes' && rawTokens.length > 1 && rawTokens[1] !== 'on' && rawTokens[1] !== 'off') ||
        (rawCmd === prefix + 'concorrentes' && rawTokens.length > 1 && rawTokens[1] !== 'on' && rawTokens[1] !== 'off') ||
        (rawCmd === prefix + 'banirconcorrentes')
    )

    const isToggleCmd = (
        (rawCmd === prefix + 'anticoncorrencia' || rawCmd === prefix + 'anticoncorrentes') &&
        (rawTokens[1] === 'on' || rawTokens[1] === 'off')
    )

    if (!isAnticoncorrenciaMenu && !isMapCmd && !isPermitirCmd && !isProibirCmd && !isAddManualCmd && !isActionCmd && !isToggleCmd) {
        return false
    }

    const isGroup = from.endsWith('@g.us')
    if (!isGroup) {
        await sock.sendMessage(from, { text: '❌ Este comando é só para grupos.' }, { quoted: msg })
        return true
    }

    const isOwner = isOwnerCheck(sender, msg)
    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}

    if (!isOwner && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Só administradores do grupo ou o Dono podem executar isto.' }, { quoted: msg })
        return true
    }

    const dotJid = from.replace(/\./g, '___dot___')
    const groupConfig = configManager.loadGroupConfig()
    if (!groupConfig[from]) groupConfig[from] = {}

    if (isToggleCmd) {
        const option = rawTokens[1].toLowerCase()
        const isAtivar = option === 'on'

        groupConfig[from].anticoncorrencia = isAtivar
        configManager.saveGroupConfig(groupConfig)

        const statusStr = isAtivar ? '🟢 *ATIVADO*' : '🔴 *DESATIVADO*'
        const descStr = isAtivar
            ? 'Admins de outros grupos e números da blacklist serão banidos ao entrar ou ao serem detectados aqui.'
            : 'O banimento automático de concorrentes está desligado.'

        await sock.sendMessage(from, {
            text: `🛡️ *ANTI-CONCORRÊNCIA: ${statusStr}*\n\n${descStr}\n\n💡 Use \`.concorrentes\` para ver os concorrentes no grupo.`
        }, { quoted: msg })
        return true
    }

    if (isPermitirCmd) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant
        const alvo = mentioned[0] || quotedParticipant || rawTokens[2]

        if (!alvo) {
            await sock.sendMessage(from, {
                text: '❌ Marque ou informe quem deve ser liberado neste grupo!\n\n_Exemplo: .concorrente permitir @usuario_'
            }, { quoted: msg })
            return true
        }

        const alvoNum = alvo.split('@')[0].split(':')[0].replace(/\D/g, '')
        if (!groupConfig[from].concorrentes_whitelist) {
            groupConfig[from].concorrentes_whitelist = []
        }

        if (!groupConfig[from].concorrentes_whitelist.includes(alvoNum)) {
            groupConfig[from].concorrentes_whitelist.push(alvoNum)
            configManager.saveGroupConfig(groupConfig)
        }

        await sock.sendMessage(from, {
            text: `✅ *CONCORRENTE LIBERADO AQUI!*\n\n@${alvoNum} entrou na lista de exceções (*whitelist*) deste grupo e não será banido pelo Anti-Concorrência.\n\n_Nota: nos outros grupos com proteção ativa ele segue bloqueado._`,
            mentions: [alvo]
        }, { quoted: msg })
        return true
    }

    if (isProibirCmd) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant
        const alvo = mentioned[0] || quotedParticipant || rawTokens[2]

        if (!alvo) {
            await sock.sendMessage(from, {
                text: '❌ Marque ou informe quem deve sair da whitelist!\n\n_Exemplo: .concorrente proibir @usuario_'
            }, { quoted: msg })
            return true
        }

        const alvoNum = alvo.split('@')[0].split(':')[0].replace(/\D/g, '')

        if (groupConfig[from].concorrentes_whitelist) {
            groupConfig[from].concorrentes_whitelist = groupConfig[from].concorrentes_whitelist.filter(n => n !== alvoNum)
            configManager.saveGroupConfig(groupConfig)
        }

        await sock.sendMessage(from, {
            text: `🔒 *CONCORRENTE BLOQUEADO AQUI!*\n\n@${alvoNum} volta às regras normais do Anti-Concorrência neste grupo.`,
            mentions: [alvo]
        }, { quoted: msg })
        return true
    }

    if (isAddManualCmd) {
        const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || []
        const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant
        const alvo = mentioned[0] || quotedParticipant || rawTokens[2]

        if (!alvo) {
            await sock.sendMessage(from, {
                text: '❌ Marque ou informe quem deve entrar como concorrente!\n\n_Exemplo: .concorrente add @usuario_'
            }, { quoted: msg })
            return true
        }

        const alvoNum = alvo.split('@')[0].split(':')[0].replace(/\D/g, '')
        const concStoreData = concorrentesStore.loadSync() || {}
        if (!concStoreData.global) concStoreData.global = []

        if (!concStoreData.global.includes(alvoNum)) {
            concStoreData.global.push(alvoNum)
            concorrentesStore.save(concStoreData)
        }

        await sock.sendMessage(from, {
            text: `🚫 *CONCORRENTE NA BLACKLIST GLOBAL!*\n\n@${alvoNum} foi marcado como concorrente e será barrado em todo grupo com Anti-Concorrência ativo.`,
            mentions: [alvo]
        }, { quoted: msg })
        return true
    }

    if (isAnticoncorrenciaMenu && rawTokens.length === 1 && rawCmd.includes('anticoncorrencia')) {
        const status = groupConfig[from]?.anticoncorrencia ? '🟢 *ATIVADO*' : '🔴 *DESATIVADO*'
        const whitelist = groupConfig[from]?.concorrentes_whitelist || []
        const whitelistStr = whitelist.length > 0 ? whitelist.map(w => `@${w}`).join(', ') : '_Nenhum (todos bloqueados)_'

        await sock.sendMessage(from, {
            text: [
                '🛡️ *SISTEMA ANTI-CONCORRÊNCIA*',
                '────────────────────────',
                `📌 *Status aqui:* ${status}`,
                `🤝 *Liberados (Whitelist local):* ${whitelistStr}`,
                '',
                '📋 *Comandos:*',
                `• \`${prefix}anticoncorrencia on\` ➔ Liga a proteção automática`,
                `• \`${prefix}anticoncorrencia off\` ➔ Desliga a proteção`,
                `• \`${prefix}concorrentes\` ➔ Lista concorrentes presentes no grupo`,
                `• \`${prefix}concorrentes banir\` ➔ Remove todos os concorrentes listados`,
                `• \`${prefix}concorrente permitir @user\` ➔ Libera um parceiro só neste grupo`,
                `• \`${prefix}concorrente proibir @user\` ➔ Cancela a liberação do concorrente`
            ].join('\n'),
            mentions: whitelist.map(w => `${w}@s.whatsapp.net`)
        }, { quoted: msg })
        return true
    }

    if (isMapCmd || (rawCmd === prefix + 'concorrentes' && rawTokens.length === 1)) {
        try { await sock.sendMessage(from, { react: { text: '🔍', key: msg.key } }) } catch {}

        try {
            const currentGroupMeta = await sock.groupMetadata(from)
            const currentParticipants = currentGroupMeta.participants || []
            const currentAdmins = currentParticipants
                .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                .map(p => (p.id || '').split('@')[0].split(':')[0].replace(/\D/g, ''))

            const currentCommonMembers = currentParticipants.filter(p => !p.admin)
            const commonMemberNums = new Set(currentCommonMembers.map(p => (p.id || '').split('@')[0].split(':')[0].replace(/\D/g, '')))

            const adminMap = await coletarAdminsDeOutrosGrupos(sock, from)

            const concStoreData = concorrentesStore.loadSync() || {}
            const manualGlobal = concStoreData.global || []

            const whitelistLocal = new Set(groupConfig[from]?.concorrentes_whitelist || [])
            const concorrentesEncontrados = []

            for (const [adminNum, info] of adminMap.entries()) {
                if (commonMemberNums.has(adminNum) && !currentAdmins.includes(adminNum)) {
                    concorrentesEncontrados.push({
                        ...info,
                        isWhitelisted: whitelistLocal.has(adminNum)
                    })
                }
            }

            for (const manualNum of manualGlobal) {
                if (commonMemberNums.has(manualNum) && !currentAdmins.includes(manualNum) && !adminMap.has(manualNum)) {
                    concorrentesEncontrados.push({
                        id: `${manualNum}@s.whatsapp.net`,
                        numero: manualNum,
                        grupos: ['Blacklist Manual Global'],
                        gruposIds: [],
                        isWhitelisted: whitelistLocal.has(manualNum)
                    })
                }
            }

            global.concorrentesMapeados[from] = {
                timestamp: Date.now(),
                lista: concorrentesEncontrados
            }

            if (concorrentesEncontrados.length === 0) {
                try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
                await sock.sendMessage(from, {
                    text: [
                        '🛡️ *MAPEAMENTO DE CONCORRÊNCIA*',
                        '────────────────────────',
                        '✅ *Nenhum concorrente detectado!*',
                        '',
                        'Não há administradores de outros grupos autorizados como membros comuns aqui.'
                    ].join('\n')
                }, { quoted: msg })
                return true
            }

            const linhas = [
                '🛡️ *CONCORRENTES IDENTIFICADOS NO GRUPO*',
                '────────────────────────',
                `👥 *Grupo:* ${currentGroupMeta.subject}`,
                `🚨 *Detectados:* ${concorrentesEncontrados.length} concorrente(s)`,
                '',
                'Estes membros são *Administradores* de outros grupos de vendas:',
                ''
            ]

            const mentions = []
            concorrentesEncontrados.forEach((c, idx) => {
                const statusTag = c.isWhitelisted ? ' 🟢 *(Liberado aqui)*' : ' 🔴 *(Bloqueável)*'
                linhas.push(`*${idx + 1}.* @${c.numero}${statusTag}`)
                c.grupos.forEach(grp => {
                    linhas.push(`   └ 📌 Admin em: *${grp}*`)
                })
                mentions.push(`${c.numero}@s.whatsapp.net`)
            })

            linhas.push('')
            linhas.push('────────────────────────')
            linhas.push('💡 *Para banir os concorrentes:*')
            linhas.push(`👉 \`${prefix}concorrentes banir\` (remove todos os não liberados)`)
            linhas.push(`👉 \`${prefix}concorrente permitir @user\` (libera parceiro aqui)`)

            try { await sock.sendMessage(from, { react: { text: '⚠️', key: msg.key } }) } catch {}

            await sock.sendMessage(from, {
                text: linhas.join('\n'),
                mentions
            }, { quoted: msg })

            return true

        } catch (err) {
            console.error('[CONCORRENTES-MAP] Erro ao mapear:', err)
            await sock.sendMessage(from, { text: `❌ *Falha ao listar concorrentes:* ${err.message}` }, { quoted: msg })
            return true
        }
    }

    if (isActionCmd) {
        const cache = global.concorrentesMapeados[from]
        if (!cache || !cache.lista || cache.lista.length === 0 || (Date.now() - cache.timestamp > 15 * 60 * 1000)) {
            await sock.sendMessage(from, {
                text: `⚠️ *Liste antes:* digite \`${prefix}concorrentes\` para identificar os concorrentes antes de remover.`
            }, { quoted: msg })
            return true
        }

        const whitelistLocal = new Set(groupConfig[from]?.concorrentes_whitelist || [])
        const alvosParaBanir = cache.lista.filter(c => !whitelistLocal.has(c.numero) && !c.isWhitelisted)

        if (alvosParaBanir.length === 0) {
            await sock.sendMessage(from, {
                text: '✅ Todos os concorrentes detectados estão na whitelist e foram poupados.'
            }, { quoted: msg })
            return true
        }

        try { await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }) } catch {}

        const removidos = []
        const mentions = []

        for (const alvo of alvosParaBanir) {
            try {
                await sock.groupParticipantsUpdate(from, [alvo.id || `${alvo.numero}@s.whatsapp.net`], 'remove')
                removidos.push(alvo)
                mentions.push(alvo.id || `${alvo.numero}@s.whatsapp.net`)
            } catch (banErr) {
                console.error(`[CONCORRENTES] Erro ao remover ${alvo.numero}:`, banErr.message)
            }
        }

        const idsRemovidos = new Set(removidos.map(r => r.numero))
        cache.lista = cache.lista.filter(c => !idsRemovidos.has(c.numero))

        try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}

        const relatorio = [
            '🛡️ *CONCORRENTES REMOVIDOS!*',
            '────────────────────────',
            `🚫 *Removidos:* ${removidos.length} concorrente(s)`,
            ''
        ]

        removidos.forEach((r, i) => {
            relatorio.push(`*${i + 1}.* @${r.numero} (Admin em: _${r.grupos.join(', ')}_)`)
        })

        await sock.sendMessage(from, {
            text: relatorio.join('\n'),
            mentions
        }, { quoted: msg })

        return true
    }

    return false
}
