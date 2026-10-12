/** `ft` followed by one of its commands, at the start of a word; group 1 is what precedes it. */
export const FT_COMMAND =
    /(^|[\s`'"(])ft (?=(?:run|start|watch|list|show|stop|guide|doctor|key|pin|init|schema)\b)/gm
