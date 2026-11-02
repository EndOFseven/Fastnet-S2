const config = require('../../../data/config.json')
const { isAdmin, isOwnerCheck } = require('../../utils/baileys')
const { obterVinculo, vincular, concluirVinculo } = require('../../auto/vinculo')
const { fetchFirebase, deleteFirebase } = require('../../utils/firebaseConfig')

function esperar(ms) {
    return new Promise(r => setTimeout(r, ms))
}

function mensagemConectado(codigo, autoAtivo) {
    const prefix = config.prefix || '.'
    return [
        '🤖 *SERVIDOR CONECTADO* ',
        '',
        '✅  Grupo conectado com êxito!',
        `🔑  Servidor: *${codigo}*`,
        `📡  Estado: *${autoAtivo ? 'ATIVO' : 'INATIVO'}*`,
        '',
        `📤  Envie pedidos por *${prefix}enviarauto*`,
        `📋  Veja o andamento em *${prefix}fila*`,
        '──────────────────'
    ].join('\n')
}

async function aguardarConfirmacaoApp(sock, from, msg, resultado) {
    const raiz = `device_pairings/${resultado.codigo}/group_requests/${resultado.requestKey}`
    for (let i = 0; i < 120; i++) {
        await esperar(5000)
        try {
            const req = await fetchFirebase(raiz)
            if (!req) continue
            const st = String(req.status || '').toUpperCase()
            if (st === 'APROVADO') {
                await concluirVinculo(from, resultado.codigo, { grupoNome: req.groupName })
                try { await deleteFirebase(raiz) } catch {}
                await sock.sendMessage(from, { text: mensagemConectado(resultado.codigo, true) }, { quoted: msg })
                try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
                return
            }
            if (st === 'RECUSADO') {
                try { await deleteFirebase(raiz) } catch {}
                await sock.sendMessage(from, { text: '❌ O pedido de vínculo foi *recusado no app*.' }, { quoted: msg })
                return
            }
        } catch {}
    }
    await sock.sendMessage(from, { text: '⏳ O pedido de vínculo *expirou* sem confirmação no app.\nUse `.vincular <código>` novamente.' }, { quoted: msg })
}

async function vincularHandler(sock, msg, from, sender, text) {
    const prefix = config.prefix || '.'
    const cmd = String(text || '').trim().split(/\s+/)[0].toLowerCase()
    const nomes = [prefix + 'vincular', prefix + 'conectarapp', prefix + 'conectar', prefix + 'linkar']
    if (!nomes.includes(cmd)) return false

    if (!from.endsWith('@g.us')) {
        await sock.sendMessage(from, { text: '❌ Esse comando só funciona em grupos.' }, { quoted: msg })
        return true
    }

    let isAdm = false
    try { isAdm = await isAdmin(sock, from, sender) } catch {}
    if (!isOwnerCheck(sender, msg) && !isAdm) {
        await sock.sendMessage(from, { text: '❌ Apenas administradores do grupo ou o Dono do bot podem ligar este grupo a um servidor.' }, { quoted: msg })
        return true
    }

    const partes = String(text || '').trim().split(/\s+/)
    const codigo = partes[1] ? partes[1].trim() : ''

    if (!codigo) {
        let grupoNome = ''
        try {
            const meta = await sock.groupMetadata(from)
            grupoNome = meta?.subject || ''
        } catch {}

        const ajuda = [
            '🤖 *CONECTAR SERVIDOR* ',
            '',
            `🔌 ${prefix}vincular <codigo>`,
            '',
            '_Informe o código exibido no app FastNet S2_',
            '_(ex.: S2-123456 ou USSD-XXXX-XXXX)._',
            '',
            grupoNome ? `📛 Grupo: ${grupoNome}` : '📛 Grupo ainda sem nome',
            '──────────────────'
        ].join('\n')
        await sock.sendMessage(from, { text: ajuda }, { quoted: msg })
        return true
    }

    let grupoNome = ''
    try {
        const meta = await sock.groupMetadata(from)
        grupoNome = meta?.subject || ''
    } catch {}

    const resultado = await vincular(from, codigo, {
        grupoNome,
        solicitadoPor: sender,
        solicitadoPorNome: msg.pushName || ''
    })
    if (!resultado.ok) {
        await sock.sendMessage(from, { text: `❌ ${resultado.motivo}` }, { quoted: msg })
        return true
    }

    if (resultado.aguardandoConfirmacao) {
        await sock.sendMessage(from, {
            text: [
                '🔐 *CONFIRMAÇÃO NECESSÁRIA NO APP*',
                '──────────────────',
                'Este servidor já está ligado a outro grupo.',
                'Para autorizar *este* grupo, abre o app FastNet S2 e digita o código:',
                '',
                `*${resultado.codigo4}*`,
                '',
                '⏳ Tens 10 minutos. O grupo é ligado automaticamente após a confirmação no app.'
            ].join('\n')
        }, { quoted: msg })
        aguardarConfirmacaoApp(sock, from, msg, resultado).catch(() => {})
        return true
    }

    const atual = obterVinculo(from)
    await sock.sendMessage(from, { text: mensagemConectado(resultado.codigo, atual.autoAtivo) }, { quoted: msg })
    try { await sock.sendMessage(from, { react: { text: '✅', key: msg.key } }) } catch {}
    return true
}

vincularHandler.nome = 'vincular'
vincularHandler.name = 'vincular'
vincularHandler.aliases = ['conectarapp', 'conectar', 'linkar']
vincularHandler.categoria = 'auto'
vincularHandler.subcategoria = 'AUTOMAÇÃO'
vincularHandler.descricao = 'Conecta este grupo a um servidor do aplicativo FastNet S2'
vincularHandler.uso = `${config.prefix}vincular <codigo>`
vincularHandler.apenasAdmin = true

module.exports = vincularHandler
