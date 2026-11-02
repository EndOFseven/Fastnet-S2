const verificacao = require('./verificacao')
const oficial = require('./comprovantesOficiais')
const { aprovarPendente, recusarPendente } = require('./aprovacao')

const INTERVALO_MS = 15 * 1000
const ESPERA_SMS_MS = 10 * 60 * 1000

let timer = null
let rodando = false
let obterSock = null

async function resolverPendente(sock, pendente) {
    const resultado = await oficial.verificar({
        codigo: pendente.codigo,
        valorEsperado: pendente.valor,
        centralCode: pendente.centralCode
    })
    if (resultado.aprovado) {
        await oficial.limparEspera(pendente.codigo)
        await aprovarPendente(sock, pendente, { origemLabel: 'SMS oficial da operadora', por: 'sms-oficial' })
        return
    }

    if (resultado.motivo === 'sms_sem_assinatura') {
        const motivos = Array.isArray(pendente.motivos) ? pendente.motivos : []
        verificacao.salvarPendente({
            ...pendente,
            status: 'AGUARDANDO_ADMIN',
            motivos: [...new Set([...motivos, 'app_desatualizado'])]
        })
        await oficial.limparEspera(pendente.codigo)
        return
    }

    if (!resultado.aguardar) {
        if (resultado.motivo === 'em_processamento') return
        await oficial.limparEspera(pendente.codigo)
        await recusarPendente(sock, pendente, { motivo: resultado.motivo })
    }
}

async function ciclo() {
    if (rodando) return
    rodando = true
    try {
        const sock = typeof obterSock === 'function' ? obterSock() : null
        if (!sock) return

        const pendentes = verificacao.listarPendentes().filter(p => p && p.status === 'AGUARDANDO_SMS')
        for (const pendente of pendentes) {
            const idade = Date.now() - (Number(pendente.criadoEm) || 0)
            if (idade > ESPERA_SMS_MS) {
                await oficial.limparEspera(pendente.codigo)
                await recusarPendente(sock, pendente, { motivo: 'pagamento_nao_confirmado' })
                continue
            }
            try {
                await resolverPendente(sock, pendente)
            } catch (err) {
                console.error(`[VERIF-SMS] Falha ao conferir ${pendente.codigo}:`, err.message)
            }
        }
    } catch (err) {
        console.error('[VERIF-SMS] Erro no ciclo:', err.message)
    } finally {
        rodando = false
    }
}

function iniciarMonitorOficial(getSock) {
    obterSock = getSock
    if (timer) return
    timer = setInterval(ciclo, INTERVALO_MS)
    console.log('[VERIF-SMS] Monitor de confirmação por SMS iniciado.')
}

function pararMonitorOficial() {
    if (!timer) return
    clearInterval(timer)
    timer = null
    console.log('[VERIF-SMS] Monitor de confirmação por SMS parado.')
}

module.exports = {
    ESPERA_SMS_MS,
    iniciarMonitorOficial,
    pararMonitorOficial,
    ciclo
}
