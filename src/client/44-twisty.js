    function twisty(props) {
      return h('span', {
        className: 'dsh-git-tw',
        title: props.collapsed === true ? '展开' : '折叠',
        onClick: function (event) {
          event.stopPropagation()
          props.onToggle()
        },
      }, props.collapsed === true ? '▶' : '▼')
    }

