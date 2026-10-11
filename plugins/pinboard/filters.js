/*\
title: $:/plugins/lasjoh-toho/pinboard/filters.js
type: application/javascript
module-type: filteroperator

Filter operators used by Pinboard cards to show only part of a long
tiddler:

[<title>pinboardexcerpt[]]  wikitext up to the first <br> or blank line
[<title>pinboardimage[]]    wikitext showing the tiddler's first image

\*/

"use strict";

var Text = require("./lib/text.js");

exports.pinboardexcerpt = function(source, operator, options) {
	var results = [];
	source(function(tiddler, title) {
		var text = tiddler ? (tiddler.fields.text || "") : "";
		results.push(Text.excerpt(text));
	});
	return results;
};

exports.pinboardimage = function(source, operator, options) {
	var results = [];
	var wiki = options.wiki;
	source(function(tiddler, title) {
		var image = Text.firstImage(wiki, title);
		if (image) {
			results.push(image);
		}
	});
	return results;
};
