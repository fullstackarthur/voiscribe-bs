reverse | .[].jsonPayload | select(.event != null) | [.event, (.pageTitle // ""), (.pageText // ""), (.bodyText // ""), (.err.message // ""), (.url // "")] | join(" | ")
