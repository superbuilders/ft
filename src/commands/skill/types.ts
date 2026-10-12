/**
 * Where one `ft skill` puts the skill: a repository, or one person's home.
 */
export interface SkillPlacement {
    /** Directory the skill goes under, as `.agents/skills/ft/`. */
    base: string
    /** Also link the skill into `.claude/skills/`. */
    linkClaude: boolean
}
