/**
 * Where one `ft init` puts things: a repository, or one person's config directory and home.
 */
export interface Placement {
    /** Directory that holds `.ft.json` and `.ft/`. */
    root: string
    /** Directory the skill goes under, as `.agents/skills/ft/`. */
    skillBase: string
    /** Also link the skill into `.claude/skills/`. */
    linkClaude: boolean
    /** Write the repository launcher `.ft/ft`. */
    launcher: boolean
}
