
    ctx.effect(function () {
      return slots.inject('conversation.input.left', function () {
        return slots.register({ name: 'conversation.input.left', id: 'gitops-git-chip', order: 10 }, GitChip)
      })
    }, 'gitops composer chip')

    ctx.effect(function () {
      return slots.inject('conversation.input.overlay', function () {
        return slots.register({ name: 'conversation.input.overlay', id: 'gitops-git-panel', order: 10 }, GitPopover)
      })
    }, 'gitops composer panel')

    /* A page of its own in Settings, between Agent presets (20) and Market (40). */
    ctx.effect(function () {
      return slots.inject('settings.section', function () {
        return slots.register({ name: 'settings.section', id: 'gitops', order: 30, label: 'Git' }, GitSettingsSection)
      })
    }, 'gitops settings section')
  },
}
