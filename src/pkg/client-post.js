    })()

    exports.name = 'dsh-git-idea'
    /* Cordis service injection, resolved by the vendored Loader: the panel
       registers into \`slots\`, so the plugin parks until the page has it.
       \`timer\` is read with ctx.get and survives its absence. */
    exports.inject = ['slots']
    exports.apply = function (ctx) { return plugin.apply(ctx) }
    return module.exports
  },
})
