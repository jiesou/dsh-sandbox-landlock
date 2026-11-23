window.__ModuleLoader__.load({
  id: 'dsh-sandbox-better',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const TOOL = 'request_write_access'
    const NS = 'sandbox-better'

    const en = {
      waiting: 'Waiting for your approval',
      allow: 'Allow for this session',
      reject: 'Reject',
      question: (path) => `Allow writes under ${path}?`,
    }
    const zh = {
      waiting: '等待你的批准',
      allow: '本会话允许',
      reject: '拒绝',
      question: (path) => `允许写入 ${path}？`,
    }
    const ja = {
      waiting: '承認をお待ちしています',
      allow: 'このセッションで許可',
      reject: '拒否',
      question: (path) => `${path} への書き込みを許可しますか？`,
    }

    const styles = {
      frame: {
        display: 'flex',
        justifyContent: 'center',
        padding: '6px calc(var(--dsh-composer-side-clearance, 0px) + 16px) 10px',
      },
      card: {
        width: '100%',
        maxWidth: 'var(--dsh-chat-content-width, 748px)',
        borderRadius: 'var(--dsw-radius-xl, 12px)',
        background: 'var(--dsw-specific-input-major, #1b1b1d)',
        color: 'var(--dsw-alias-label-primary, #e6e6e6)',
        boxShadow: 'var(--dsw-elevation-panel, 0 8px 24px rgba(0,0,0,.24))',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '16px 20px',
        boxSizing: 'border-box',
      },
      eyebrow: {
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--dsw-alias-label-tertiary, #8a8a8a)',
      },
      title: {
        margin: 0,
        fontSize: 15,
        lineHeight: '22px',
        fontWeight: 500,
        wordBreak: 'break-word',
      },
      actions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
      button: {
        font: 'inherit',
        fontSize: 13,
        lineHeight: '20px',
        padding: '6px 14px',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '1px solid var(--dsw-alias-border-l2, #3a3a3d)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      primary: {
        border: '1px solid transparent',
        background: 'var(--dsw-alias-button-info-fill, #4b6cf6)',
        color: 'var(--dsw-alias-label-primary-foreground, #fff)',
      },
    }

    function Panel(props) {
      const pending = props.matched
      const [busy, setBusy] = React.useState(false)
      const answer = (outcome) => {
        if (busy) return
        setBusy(true)
        pending.answer(outcome).catch(() => setBusy(false))
      }
      const reason = pending.displayReason === undefined
        ? undefined
        : props.resolveReason(pending.displayReason)
      return h('div', { style: styles.frame, 'data-sandbox-permission-request': pending.callId ?? 'root' },
        h('div', { style: styles.card, role: 'group', 'aria-busy': busy },
          h('div', { style: styles.eyebrow }, props.t('waiting')),
          h('p', { style: styles.title }, reason ?? pending.reason ?? ''),
          h('div', { style: styles.actions },
            h('button', {
              type: 'button',
              style: styles.button,
              disabled: busy,
              onClick: () => answer('rejected'),
            }, props.t('reject')),
            h('button', {
              type: 'button',
              style: { ...styles.button, ...styles.primary },
              disabled: busy,
              onClick: () => answer('allowed-once'),
            }, props.t('allow')))))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh, ja }), 'sandbox-better: dictionaries')
        ctx.slots.inject('conversation.composer', () => ctx.slots.register({
          name: 'conversation.composer',
          priority: -1,
          locale: NS,
          select: ({ pendingInteraction }) => pendingInteraction !== undefined
            && pendingInteraction.kind === 'approval'
            && pendingInteraction.toolName === TOOL
            ? pendingInteraction
            : null,
          inject: () => ({
            resolveReason: (reason) => ctx.locale.resolveText(reason),
          }),
        }, Panel))
      },
    }
  },
})
