const BULLET_MARKERS = '[\\u2022\\u00b7\\u25cf\\u25cb\\u25aa\\u25e6\\u2043\\u2713\\u2714*-]|[\\u2013\\u2014]|ü';
const BULLET_PATTERN = new RegExp(`^(?:${BULLET_MARKERS})\\s+`, 'u');
const STANDALONE_BULLET_PATTERN = new RegExp(`^(?:${BULLET_MARKERS})$`, 'u');
const NUMBER_PATTERN = /^([0-9\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]+)[.)\u06d4]\s*/u;
const SENTENCE_END_PATTERN = /[.!?\u061f\u06d4;\u061b]\s*$/u;

const HEADING_PATTERNS = [
    /^about(?:\s+(?:the\s+)?[\p{L}\p{N}&'()./-]+){0,8}$/iu,
    /^(?:job|role|position|vacancy)\s+(?:description|descriptions|summary|overview|purpose)(?:\s*\/\s*objective)?$/iu,
    /^(?:(?:key\s+)?duties|responsibilities|duties\s+and\s+responsibilities|key\s+responsibilities|key\s+responsibilities\s*&\s*operational\s+duties)$/iu,
    /^(?:job\s+)?(?:requirements|qualifications|qualifications\s+and\s+skills|required\s+qualifications|minimum\s+qualifications)$/iu,
    /^(?:technical|professional|personal|preferred|minimum|academic)\s+(?:requirements|qualifications|skills|competencies)$/iu,
    /^(?:technical|core|key|required|preferred|language|computer|interpersonal)\s+(?:skills|competencies)$/iu,
    /^(?:education|experience|certification|certifications|languages?|skills|competencies)$/iu,
    /^(?:submission|application)\s+(?:guideline|guidelines|instructions|procedure|procedures)$/iu,
    /^(?:submission\s+email|email\s+address|how\s+to\s+apply|important\s+notes?|required\s+documents|what\s+you\s+will\s+gain)$/iu,
    /^(?:benefits|remuneration|salary|location|duration|reporting\s+line|department)$/iu,
    /^(?:backend|back-end|frontend|front-end|familiar\s+with|data\s+center\s+responsibilities)$/iu,
    /^(?:our\s+vision|our\s+mission|our\s+services)$/iu,
    /^(?:(?:system|network|data|incident|policy|documentation|development|wordpress|aws|ict|scope)\b.{0,65}(?:&|and)\b.{1,35})$/iu,
    /^(?:technical\s+leadership|other\s+professional\s+requirements|ecommerce|seo)$/iu,
];

const LIST_HEADING_PATTERN = /(?:dut|responsibil|require|qualification|skill|competen|certification|guideline|instruction|procedure|important\s+note|what\s+you\s+will\s+gain|benefit|backend|back-end|frontend|front-end|familiar\s+with|education|experience)/iu;

function cleanLine(value) {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function headingCore(value) {
    return value
        .replace(/^#{1,6}\s+/, '')
        .replace(/^\*\*(.+)\*\*$/, '$1')
        .replace(NUMBER_PATTERN, '')
        .replace(/:\s*$/, '')
        .trim();
}

function isHeading(value, nextLine = '') {
    const core = headingCore(value);
    if (!core || core.length > 110 || BULLET_PATTERN.test(value) || STANDALONE_BULLET_PATTERN.test(value)) return false;
    if (HEADING_PATTERNS.some(pattern => pattern.test(core))) return true;

    const words = core.split(/\s+/u);
    const shortLabel = value.trim().endsWith(':') && words.length <= 10 && !/[.!?\u061f\u06d4]/u.test(core);
    const introducesBullets = core.length <= 90
        && words.length <= 10
        && /^[\p{L}\p{N}]/u.test(core)
        && (!/[,;]/u.test(core) || /\s&\s/u.test(core))
        && !SENTENCE_END_PATTERN.test(core)
        && (BULLET_PATTERN.test(nextLine) || STANDALONE_BULLET_PATTERN.test(nextLine));
    return shortLabel || introducesBullets;
}

function headingUsesList(value) {
    return LIST_HEADING_PATTERN.test(headingCore(value));
}

function normalizedHeadingKey(value) {
    return headingCore(value)
        .toLocaleLowerCase()
        .replace(/\b(?:descriptions|guidelines|requirements|qualifications|responsibilities)\b/gu, word => word.replace(/s$/u, ''))
        .replace(/\s+/gu, ' ');
}

function parseListItem(value) {
    const numbered = value.match(NUMBER_PATTERN);
    if (numbered) {
        return { type: 'ol', text: cleanLine(value.slice(numbered[0].length)) };
    }

    const bullet = value.match(BULLET_PATTERN);
    if (bullet) {
        return { type: 'ul', text: cleanLine(value.slice(bullet[0].length)) };
    }

    return null;
}

function appendListItem(blocks, type, text, explicit = false) {
    if (!text) return;
    const previous = blocks.at(-1);
    if (previous?.type === type) {
        previous.items.push(text);
        previous.explicit.push(explicit);
        return;
    }
    blocks.push({ type, items: [text], explicit: [explicit] });
}

/**
 * Convert plain scraped text into renderable semantic blocks. Text remains plain
 * strings so React escapes source markup rather than treating it as HTML.
 */
export function parseDescription(description) {
    const source = String(description ?? '').replace(/\r\n?/g, '\n').trim();
    if (!source) return [];

    const sourceLines = source.split('\n').map(cleanLine);
    const lines = [];
    for (let index = 0; index < sourceLines.length; index += 1) {
        const line = sourceLines[index];
        const next = sourceLines[index + 1];
        const wrappedHeading = line
            && next
            && `${line} ${next}`.length <= 100
            && ((line.endsWith(',') && /\s&\s/u.test(next)) || next.startsWith('& '));
        if (wrappedHeading) {
            lines.push(`${line} ${next}`);
            index += 1;
        } else {
            lines.push(line);
        }
    }
    const blocks = [];
    let listContext = false;
    let separated = true;
    let explicitItemOpen = false;
    let pendingListType = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line) {
            separated = true;
            explicitItemOpen = false;
            continue;
        }

        if (STANDALONE_BULLET_PATTERN.test(line)) {
            pendingListType = 'ul';
            explicitItemOpen = false;
            separated = false;
            continue;
        }

        if (pendingListType) {
            appendListItem(blocks, pendingListType, line, true);
            pendingListType = null;
            explicitItemOpen = true;
            separated = false;
            continue;
        }

        const nextLine = lines.slice(lineIndex + 1).find(Boolean) || '';
        if (isHeading(line, nextLine)) {
            const text = line.replace(/^#{1,6}\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
            const previous = blocks.at(-1);
            if (previous?.type !== 'heading' || normalizedHeadingKey(previous.text) !== normalizedHeadingKey(text)) {
                blocks.push({ type: 'heading', text });
            }
            listContext = headingUsesList(text);
            separated = false;
            explicitItemOpen = false;
            pendingListType = null;
            continue;
        }

        const explicitItem = parseListItem(line);
        if (explicitItem) {
            appendListItem(blocks, explicitItem.type, explicitItem.text, true);
            explicitItemOpen = true;
            pendingListType = null;
            separated = false;
            continue;
        }

        const previous = blocks.at(-1);
        const previousItem = previous?.type === 'ul' || previous?.type === 'ol'
            ? previous.items.at(-1)
            : null;
        const isLikelyWrappedItem = !separated
            && explicitItemOpen
            && previousItem
            && !SENTENCE_END_PATTERN.test(previousItem);
        const previousWasImplicit = (previous?.type === 'ul' || previous?.type === 'ol')
            && previous.explicit?.at(-1) === false;
        const isLikelyImplicitContinuation = !separated
            && listContext
            && previousWasImplicit
            && previousItem
            && !SENTENCE_END_PATTERN.test(previousItem)
            && (/^\p{Ll}/u.test(line) || previousItem.length >= 100);

        if (isLikelyWrappedItem || isLikelyImplicitContinuation) {
            previous.items[previous.items.length - 1] = `${previousItem} ${line}`;
            explicitItemOpen = isLikelyWrappedItem && !SENTENCE_END_PATTERN.test(line);
        } else if (listContext) {
            appendListItem(blocks, 'ul', line);
            explicitItemOpen = false;
        } else {
            blocks.push({ type: 'paragraph', text: line });
            explicitItemOpen = false;
        }
        separated = false;
    }

    return blocks.map(block => {
        if (block.type === 'ul' || block.type === 'ol') {
            const { explicit: _explicit, ...publicBlock } = block;
            return publicBlock;
        }
        return block;
    });
}
