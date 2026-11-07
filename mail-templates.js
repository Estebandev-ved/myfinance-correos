/**
 * Myfinance — las plantillas de cada correo. Son funciones puras: reciben datos y devuelven { subject, html }, así se
 * pueden ver de antemano (node email-preview.js) sin enviar nada. send.js solo decide a quién y cuándo.
 */
const { C, esc, hero, p, meter, bars, kpis, dots, steps, callout, rows, statTable, stat, layout, APP_URL } = require('./mail-ui')

const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0)
const firstName = (n) => esc(String(n || 'amigo').trim().split(/\s+/)[0])

const { INACTIVITY } = require('./inactivity')

/* ───────────── Bienvenida ───────────── */
function welcomeMail(m) {
  return {
    subject: '¡Bienvenido a Myfinance!',
    html: layout(
      hero({ mood: 'celebrate', title: `¡Hola, ${firstName(m.name)}!`, text: 'Ya eres parte de Myfinance. Soy Tití y voy a acompañarte con tu plata.' }) +
        p('Para empezar con el pie derecho:') +
        steps(['Registra tus movimientos del día (toma 10 segundos).', 'Ponle un tope a tus gastos en <b>Presupuesto</b>.', 'Crea una meta de ahorro y mira cómo crece.', 'Activa los <b>recordatorios por correo</b> en Más → Ajustes para no olvidarte de anotar.']) +
        callout('<b>Tip:</b> instálala en tu celular desde el menú del navegador → "Agregar a pantalla de inicio".', 'info'),
      'Recibes este correo porque acabas de entrar a Myfinance.',
      { preheader: 'Ya eres parte de Myfinance. Así empiezas.' },
    ),
  }
}

const adminJoinMail = (m) => ({ subject: `Myfinance: se unió ${m.name || m.email}`, html: layout(p(`${esc(m.name || '')} (${esc(m.email)}) acaba de entrar con su código de invitación.`), 'Aviso para el administrador.', { cta: false }) })

/* ───────────── Alertas de presupuesto ───────────── */
/** found: [{ level: 'late'|'soon', title, detail, pct }] */
function budgetMail(name, found) {
  const subject = found.length > 1 ? `Myfinance: ${found.length} alertas de presupuesto` : `Myfinance: ${found[0].title}`
  const over = found.some((f) => f.level === 'late')
  return {
    subject,
    html: layout(
      hero({ mood: over ? 'worried' : 'thinking', title: 'Mira cómo vas con tus topes', text: `${firstName(name)}, esto es lo que pasa en tus bolsillos de gasto. Aún se puede ajustar.` }) +
        bars(found.map((f) => ({ label: f.title, value: Math.min(f.pct, 100), text: `${Math.round(f.pct)}%`, color: f.level === 'late' ? C.terra : C.gold }))) +
        rows(found),
      undefined,
      { preheader: found[0].title, cta: { label: 'Ver mi presupuesto' } },
    ),
  }
}

/* ───────────── Racha ───────────── */
const MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365]
function streakMail(name, streak) {
  const next = MILESTONES.find((m) => m > streak)
  const prev = [...MILESTONES].reverse().find((m) => m <= streak) ?? 0
  return {
    subject: `¡${streak} días seguidos en Myfinance!`,
    html: layout(
      hero({ mood: 'celebrate', title: `¡${streak} días seguidos!`, text: `${firstName(name)}, eso es constancia de la buena: así se construyen las finanzas sanas.` }) +
        (next
          ? `<div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.mute};margin:4px 0 6px">Camino al siguiente hito: ${next} días</div>${meter(((streak - prev) / (next - prev)) * 100, C.gold, 12)}<div style="height:14px"></div>`
          : '') +
        p(`Mañana, a por el día ${streak + 1}.`),
      undefined,
      { preheader: `Llevas ${streak} días seguidos anotando. ¡Sigue así!` },
    ),
  }
}

/* ───────────── Meta en grupo ───────────── */
function groupMail(name, group, others, all, pct) {
  const lines = others.map((c) => `<li style="margin:4px 0"><b>${esc(c.name)}</b> aportó ${money(c.amount)}${c.note ? ` — ${esc(c.note)}` : ''}</li>`).join('')
  return {
    subject: `Myfinance: novedades en «${group.name}»`,
    html: layout(
      hero({ mood: pct >= 100 ? 'celebrate' : 'happy', title: `Se movió la meta «${esc(group.name)}»`, text: `Hola ${firstName(name)}, mira lo que pasó.` }) +
        `<ul class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${C.ink};margin:0 0 14px;padding-left:20px">${lines}</ul>` +
        `<div class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:0 0 6px">Ya llevan <b>${money(all)}</b> de ${money(group.target)}: <b>${pct}%</b></div>${meter(pct, pct >= 100 ? C.mint : C.brand, 14)}<div style="height:12px"></div>` +
        p(pct >= 100 ? '¡Meta cumplida! Gracias a todos por aportar.' : '¿Y tú ya pusiste tu parte?'),
      undefined,
      { preheader: `Ya llevan ${pct}% de la meta.`, cta: { label: 'Ver la meta' } },
    ),
  }
}

/* ───────────── Recordatorios del día ───────────── */
function reminderMail(slot, name, items, streak) {
  const n = firstName(name)
  if (slot === 'morning') {
    const urgent = items.filter((i) => i.level === 'late').length
    const subject = items.length ? (urgent ? `Myfinance: ${urgent} pendiente${urgent > 1 ? 's' : ''} vencido${urgent > 1 ? 's' : ''}` : `Myfinance: tienes ${items.length} pendiente${items.length > 1 ? 's' : ''}`) : 'Buenos días: ¿qué vas a registrar hoy?'
    const body = items.length
      ? hero({ mood: urgent ? 'worried' : 'neutral', title: `Buenos días, ${n}`, text: 'Esto es lo que necesita tu atención hoy:' }) + rows(items)
      : hero({ mood: 'happy', title: `Buenos días, ${n}`, text: 'Un buen día empieza sabiendo cuánto tienes.' }) + p('Anota lo de ayer que se te haya quedado por fuera.')
    return { subject, html: layout(body, undefined, { preheader: subject }) }
  }
  if (slot === 'afternoon') {
    return {
      subject: '¿Ya anotaste tus gastos de hoy?',
      html: layout(hero({ mood: 'thinking', title: `Hola, ${n}`, text: 'Todavía no has registrado nada hoy.' }) + p('Anotar el almuerzo y el transporte toma 10 segundos y mantiene tus cuentas claras.'), undefined, { preheader: 'Toma 10 segundos.' }),
    }
  }
  // night
  if (streak >= 3)
    return {
      subject: `No pierdas tu racha de ${streak} días`,
      html: layout(
        hero({ mood: 'worried', title: `Tu racha de ${streak} días sigue viva`, text: `${n}, hoy todavía no has anotado nada.` }) + kpis([{ label: 'Días seguidos', value: String(streak), color: C.brand }]) + p('Anota aunque sea un gasto pequeño, o toca <b>"Hoy no gasté"</b>, y tu racha sigue.'),
        undefined,
        { preheader: 'Un movimiento pequeño la mantiene.' },
      ),
    }
  return {
    subject: 'Cierra tu día en Myfinance',
    html: layout(hero({ mood: 'sleeping', title: 'Cierra tu día', text: `${n}, antes de dormir...` }) + p('Registra lo que gastaste o ganaste hoy. Mañana ya no te acordarás de los detalles.'), undefined, { preheader: 'Antes de dormir, anota el día.' }),
  }
}

/* ───────────── Resumen semanal ───────────── */
/** w: { spent, income, prevSpent, topCat, topAmount }; flags: 7 booleanos (del más viejo a hoy); labels: letras de los días */
function weeklyMail(name, w, { change, registered, flags, labels }) {
  const mood = change === null ? 'neutral' : change > 10 ? 'worried' : change < -10 ? 'celebrate' : 'happy'
  const verdict = change === null ? '' : change > 10 ? 'Gastaste más que la semana pasada: mira en qué se fue y ajusta con calma.' : change < -10 ? '¡Bajaste el gasto frente a la semana pasada! Sigue así.' : 'Vas estable frente a la semana pasada.'
  const compare = w.prevSpent > 0 ? bars([{ label: 'Semana pasada', value: w.prevSpent, text: money(w.prevSpent), color: '#9DB0AB' }, { label: 'Esta semana', value: w.spent, text: money(w.spent), color: change > 10 ? C.terra : C.brand }]) : ''
  return {
    subject: `Tu semana en Myfinance: gastaste ${money(w.spent)}`,
    html: layout(
      hero({ mood, title: 'Tu semana en un vistazo', text: `Hola ${firstName(name)}, así te fue.` }) +
        kpis([{ label: 'Gastaste', value: money(w.spent), color: C.terra }, { label: 'Ingresaste', value: money(w.income), color: C.mint }, ...(change !== null ? [{ label: 'Frente a la pasada', value: `${change > 0 ? '+' : ''}${change}%`, color: change > 10 ? C.terra : C.mint }] : [])]) +
        bars([{ label: 'Lo que entró', value: w.income, text: money(w.income), color: C.mint }, { label: 'Lo que salió', value: w.spent, text: money(w.spent), color: C.terra }]) +
        compare +
        `<div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.mute}">Días que anotaste: <b class="tx" style="color:${C.ink}">${registered} de 7</b></div>${dots(flags, labels)}` +
        (w.topCat ? callout(`Donde más gastaste: <b>${esc(w.topCat)}</b> (${money(w.topAmount)}).`, 'info') : '') +
        (verdict ? p(verdict) : ''),
      undefined,
      { preheader: `Gastaste ${money(w.spent)} esta semana.`, cta: { label: 'Ver el resumen completo', url: `${APP_URL}/resumen` } },
    ),
  }
}

/* ───────────── Cierre de mes ───────────── */
function monthlyMail(name, m, monthLabel) {
  const balance = m.income - m.expense
  return {
    subject: `Así cerró tu ${monthLabel} en Myfinance`,
    html: layout(
      hero({ mood: balance >= 0 ? 'celebrate' : 'neutral', title: `Así cerró tu ${esc(monthLabel)}`, text: `Hola ${firstName(name)}, este fue tu balance.` }) +
        kpis([{ label: 'Ingresos', value: money(m.income), color: C.mint }, { label: 'Gastos', value: money(m.expense), color: C.terra }, { label: 'Balance', value: money(balance), color: balance >= 0 ? C.mint : C.terra }]) +
        bars([{ label: 'Ingresos', value: m.income, text: money(m.income), color: C.mint }, { label: 'Gastos', value: m.expense, text: money(m.expense), color: C.terra }]) +
        (m.topCat ? callout(`Donde más gastaste: <b>${esc(m.topCat)}</b> (${money(m.topAmount)}).`, 'info') : '') +
        p(balance >= 0 ? 'Cerraste en positivo. Empieza el mes con topes nuevos en <b>Presupuesto</b> y que este sea mejor.' : 'Gastaste más de lo que ingresó, y está bien: ya lo sabes. Empieza el mes con topes nuevos en <b>Presupuesto</b>.'),
      undefined,
      { preheader: `Balance: ${money(balance)}`, cta: { label: 'Ver mi mes' } },
    ),
  }
}

/* ───────────── Correo escrito por el administrador ───────────── */
function adminMail(name, subject, body) {
  const text = esc(body).replace(/\r?\n/g, '<br>')
  return { subject, html: layout(hero({ mood: 'happy', title: `Hola, ${firstName(name)}` }) + `<p class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:${C.ink};margin:0 0 8px">${text}</p>`, 'Recibes este correo porque eres parte de Myfinance.') }
}

/* ───────────── Inactividad: avisos y cupo liberado ───────────── */
const INACTIVITY_FOOTER = 'Recibes este aviso porque tienes una cuenta en Myfinance. Tus datos nunca se borran por no usar la app.'

/** stage: 7, 14, 21 o 27 (día de inactividad en que se manda); idle: días reales sin entrar */
function inactivityMail(stage, name, idle) {
  const n = firstName(name)
  const left = Math.max(0, INACTIVITY.release - idle)
  const bar = `<div class="mu" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.mute};margin:6px 0 6px">Llevas ${idle} días sin entrar · el cupo se libera al día ${INACTIVITY.release}</div>${meter((idle / INACTIVITY.release) * 100, idle >= 21 ? C.terra : idle >= 14 ? C.gold : C.brand, 12)}<div style="height:14px"></div>`
  const keep = callout('Para conservar tu cupo basta con <b>abrir la app</b> una vez. No tienes que hacer nada más.', 'ok')
  const copy = {
    7: { mood: 'sleeping', subject: `${n}, te extrañamos en Myfinance`, title: 'Tití se quedó dormido esperándote', text: 'Hace una semana que no pasas por aquí.', body: p('No pasa nada: abre la app, anota lo que gastaste estos días y vuelve a tomar el control. Toma 2 minutos.') },
    14: { mood: 'worried', subject: `Hace dos semanas que no te vemos, ${n}`, title: 'Te estamos guardando el cupo', text: 'Llevas dos semanas sin entrar.', body: p('Tus cuentas no se organizan solas, pero ponerlas al día es más fácil de lo que parece: anota lo grande primero y lo demás después.') + p('Los cupos de Myfinance son pocos y hay gente esperando, así que no podemos guardarlos para siempre.') },
    21: { mood: 'worried', subject: `${n}, tu cupo en Myfinance está por vencer`, title: `Te quedan ${left} días de cupo`, text: 'Si no vuelves, se lo daremos a otra persona de la lista de espera.', body: p('Todavía estás a tiempo. Y si ya no quieres seguir, no pasa nada: no tienes que hacer nada y tus datos se conservan.') },
    27: { mood: 'surprised', subject: `Último aviso, ${n}: en ${left} días liberamos tu cupo`, title: `En ${left} días liberamos tu cupo`, text: 'Este es el último aviso.', body: p('Si abres la app antes, todo sigue igual. Si no, tu cuenta se desactiva y el cupo pasa a otra persona. <b>Tus datos no se borran</b> y podrás volver cuando haya un cupo libre.') },
  }[stage]
  return {
    subject: copy.subject,
    html: layout(hero({ mood: copy.mood, title: copy.title, text: copy.text }) + bar + copy.body + keep, INACTIVITY_FOOTER, { preheader: copy.text, cta: { label: 'Seguir en Myfinance' } }),
  }
}

function releasedMail(name) {
  return {
    subject: 'Liberamos tu cupo en Myfinance',
    html: layout(
      hero({ mood: 'sleeping', title: 'Liberamos tu cupo', text: `${firstName(name)}, pasaron ${INACTIVITY.release} días sin que entraras.` }) +
        p('Como los cupos son pocos, ahora lo tiene otra persona de la lista de espera. Fue tras varios avisos a este correo.') +
        callout('<b>Tus datos están a salvo:</b> siguen en tu celular y en tu respaldo. Nada se borró.', 'ok') +
        p('Si quieres volver, escríbenos o pide un código nuevo cuando haya cupo libre. Con gusto te recibimos de nuevo.'),
      INACTIVITY_FOOTER,
      { cta: { label: 'Abrir Myfinance' } },
    ),
  }
}

/** Para el administrador: cupos liberados (o que se habrían liberado, en prueba) y cuánta gente espera. */
function adminReleaseMail(list, waiting, dry) {
  const items = list.map((x) => `<li style="margin:4px 0"><b>${esc(x.name || x.email)}</b> · ${esc(x.email)} · ${x.idle} días sin entrar</li>`).join('')
  return {
    subject: dry ? `Myfinance (PRUEBA): ${list.length} cupo(s) se liberarían` : `Myfinance: ${list.length} cupo(s) liberado(s)`,
    html: layout(
      hero({ mood: 'thinking', title: dry ? 'Prueba: así se liberarían cupos' : 'Se liberaron cupos', text: dry ? 'Todavía no se tocó a nadie. Revisa la lista.' : 'Por inactividad, tras 4 avisos.' }) +
        `<ul class="tx" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:${C.ink};padding-left:20px;margin:0 0 14px">${items}</ul>` +
        callout(`Hay <b>${waiting}</b> persona(s) en la lista de espera. ${dry ? '' : 'Para darle el cupo a alguien, entra al panel → Cupos liberados.'}`, 'info'),
      'Aviso para el administrador.',
      { cta: { label: 'Abrir el panel', url: 'https://myfinance-info.web.app/admin/' } },
    ),
  }
}

module.exports = { money, firstName, INACTIVITY, MILESTONES, welcomeMail, adminJoinMail, budgetMail, streakMail, groupMail, reminderMail, weeklyMail, monthlyMail, adminMail, inactivityMail, releasedMail, adminReleaseMail, statTable, stat }
