/*\
title: $:/plugins/lasjoh-toho/pinboard/lib/text.js
type: application/javascript
module-type: library

Finding the short version of a long tiddler: the text up to the first
break, and the first image.

\*/

"use strict";

var BREAK = /<br\s*\/?>|\r?\n[ \t]*\r?\n/i;

exports.excerpt = function(text) {
	var match = BREAK.exec(text);
	return (match ? text.substr(0, match.index) : text).replace(/\s+$/, "");
};

/*
Finds the first image in a tiddler: the tiddler itself when it is an
image, otherwise the earliest [img[...]], <$image .../>, <img ...> or
transclusion of an image tiddler in its text. Returns wikitext, or "".
*/
exports.firstImage = function(wiki, title) {
	if (wiki.isImageTiddler(title)) {
		return "[img[" + title + "]]";
	}
	var tiddler = wiki.getTiddler(title);
	var text = tiddler ? (tiddler.fields.text || "") : "";
	if (!text) {
		return "";
	}
	var best = null;
	var consider = function(index, snippet) {
		if (snippet && (best === null || index < best.index)) {
			best = {index: index, snippet: snippet};
		}
	};
	var m = /\[img(?:\s[^\[\]]*)?\[[^\]]+\]\]/.exec(text);
	m && consider(m.index, m[0]);
	m = /<\$image\b[^>]*?(?:\/>|>[\s\S]*?<\/\$image>)/i.exec(text);
	m && consider(m.index, m[0]);
	m = /<img\b[^>]*>/i.exec(text);
	m && consider(m.index, m[0]);
	var transclusion = /\{\{([^{}|]+?)(?:\|\|[^{}]*)?\}\}/g;
	while ((m = transclusion.exec(text)) !== null) {
		if (best && m.index > best.index) {
			break;
		}
		var target = m[1].trim();
		if (wiki.isImageTiddler(target)) {
			consider(m.index, "[img[" + target + "]]");
			break;
		}
	}
	return best ? best.snippet : "";
};
