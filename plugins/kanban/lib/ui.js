/*\
title: $:/plugins/lasjoh-toho/kanban/lib/ui.js
type: application/javascript
module-type: library

The Kanban board's chrome: the toolbar with search, project buttons,
board settings and fullscreen, and the column settings popover.

\*/

"use strict";

var Model = require("./model.js");

var SVGNS = "http://www.w3.org/2000/svg";
var NONE = Model.NONE;

// Icons offered for columns: TiddlyWiki's own images.
var ICONS = [
	"$:/core/images/tip", "$:/core/images/list-bullet", "$:/core/images/options-button",
	"$:/core/images/preview-open", "$:/core/images/done-button", "$:/core/images/save-button",
	"$:/core/images/timestamp-off", "$:/core/images/warning", "$:/core/images/star-filled",
	"$:/core/images/new-button", "$:/core/images/edit-button", "$:/core/images/locked-padlock",
	"$:/core/images/chevron-right", "$:/core/images/globe", "$:/core/images/info-button",
	"$:/core/images/delete-button"
];
var VIEW_LABELS = {
	full: "Full cards",
	collapsible: "Foldable (title, ↕ shows the rest)",
	compact: "Compact (title only)"
};
var FIELD_CHOICES = ["title", "text", "tags", "caption", "created", "modified", "icon"];

var methods = exports.methods = {};

/*** Toolbar ***/

methods.buildToolbar = function() {
	var doc = this.document, self = this;
	this.searchInput = el(doc, "input", {type: "search", "class": "kb-search", placeholder: "Search the board"});
	this.searchInput.addEventListener("input", function() {
		self.search = self.searchInput.value.trim();
		self.computeMatches();
		self.scheduleRender();
	});
	this.projectBar = el(doc, "div", {"class": "kb-projects", role: "group", "aria-label": "Projects"});
	this.settingsButton = iconButton(doc, "⚙", "Board settings: filter, projects, column width", function() {
		self.openBoardSettings();
	});
	this.fullscreenButton = iconButton(doc, "⛶", "Fullscreen", function() {
		self.toggleFullscreen();
	});
	this.toolbar = el(doc, "div", {"class": "kb-toolbar"}, [
		el(doc, "div", {"class": "kb-search-wrap"}, [this.searchInput]),
		this.projectBar,
		el(doc, "div", {"class": "kb-toolbar-end"}, [this.settingsButton, this.fullscreenButton])
	]);
	this.root.appendChild(this.toolbar);
	this.onFullscreenChange = function() {
		if (doc.fullscreenElement === doc.documentElement) {
			self.pageFullscreen = true;
		} else if (self.pageFullscreen) {
			self.pageFullscreen = false;
			self.fullscreen = false;
		}
		self.applyFullscreen();
	};
	doc.addEventListener("fullscreenchange", this.onFullscreenChange);
};

methods.updateToolbar = function() {
	var doc = this.document, self = this;
	var projects = Model.parseList(this.graph.projects);
	var active = this.currentProject();
	var bar = this.projectBar;
	while (bar.firstChild) {
		bar.removeChild(bar.firstChild);
	}
	if (projects.length) {
		var chip = function(label, tag) {
			var on = tag ? active === tag : !self.graph.boardFilter;
			var b = el(doc, "button", {"class": "kb-chip" + (on ? " kb-chip-on" : ""), type: "button", text: label,
				title: tag ? "Show the project “" + tag + "” (cards tagged " + tag + ")" : "Show all cards"});
			b.addEventListener("click", function() {
				self.setBoardFilter(tag ? Model.projectFilter(tag) : "");
			});
			return b;
		};
		bar.appendChild(chip("All", null));
		projects.forEach(function(tag) { bar.appendChild(chip(tag, tag)); });
	}
	if (this.graph.boardFilter && !active) {
		var custom = el(doc, "span", {"class": "kb-chip kb-chip-on kb-chip-filter", text: this.graph.boardFilter, title: "Board filter (change it in the board settings)"});
		bar.appendChild(custom);
	}
	this.settingsButton.style.display = this.canConfigure() ? "" : "none";
};

/*** Filtering ***/

/*
Which cards pass the board filter and the search. The board filter is a
TiddlyWiki filter run (e.g. one project's tag); the search looks for all
its words in the card's fields.
*/
methods.computeMatches = function() {
	var filter = (this.graph.boardFilter || "").trim();
	this.filterSet = null;
	if (filter) {
		var titles = [];
		try {
			titles = this.wiki.filterTiddlers(filter, this.parentWidget);
		} catch (e) {}
		this.filterSet = Object.create(null);
		var set = this.filterSet;
		titles.forEach(function(t) { set[t] = true; });
		this.filterKey = filter;
	}
	this.searchWords = this.search ? this.search.toLowerCase().split(/\s+/) : null;
};

methods.cardShown = function(id) {
	if ((this.graph.boardFilter || "").trim() !== (this.filterKey || "") || (this.graph.boardFilter && !this.filterSet)) {
		this.computeMatches();
	}
	if (this.filterSet && !this.filterSet[id]) {
		return false;
	}
	if (this.searchWords) {
		var tiddler = this.wiki.getTiddler(id);
		var hay = [id, this.nodes[id] && this.nodes[id].label || ""];
		if (tiddler) {
			for (var f in tiddler.fields) {
				var v = tiddler.fields[f];
				hay.push(Array.isArray(v) ? v.join(" ") : (v instanceof Date ? "" : String(v)));
			}
		}
		hay = hay.join("\n").toLowerCase();
		return this.searchWords.every(function(w) { return hay.indexOf(w) >= 0; });
	}
	return true;
};

methods.currentProject = function() {
	return Model.activeProject(this.graph.boardFilter, Model.parseList(this.graph.projects));
};

methods.setBoardFilter = function(filter) {
	if (this.graph.store) {
		this.setGraphProperty("boardFilter", filter);
	} else {
		this.graph.boardFilter = filter || undefined;
	}
	this.computeMatches();
	this.scheduleRender();
};

/*** Fullscreen ***/

/*
The whole page goes fullscreen and the board covers it, so TiddlyWiki's
own dialogs still open on top of it.
*/
methods.toggleFullscreen = function() {
	var doc = this.document;
	try {
		if (this.fullscreen || doc.fullscreenElement) {
			this.fullscreen = false;
			var exit = doc.fullscreenElement && doc.exitFullscreen && doc.exitFullscreen();
			exit && exit.catch && exit.catch(function() {});
		} else {
			this.fullscreen = true;
			var html = doc.documentElement;
			var enter = html.requestFullscreen && html.requestFullscreen();
			enter && enter.catch && enter.catch(function() {});
		}
	} catch (e) {}
	this.applyFullscreen();
};

methods.applyFullscreen = function() {
	this.root.classList.toggle("kb-fullscreen", !!this.fullscreen);
	this.fullscreenButton.classList.toggle("kb-on", !!this.fullscreen);
	this.scheduleEdges();
};

/*** Popovers ***/

methods.closePopover = function() {
	if (this.popover) {
		remove(this.popover.el);
		this.popover.cleanup && this.popover.cleanup();
		this.popover = null;
	}
};

methods.openPopover = function(content, anchor, key) {
	var doc = this.document, self = this;
	var wasSame = this.popover && this.popover.key === key;
	this.closePopover();
	if (wasSame) {
		return null;
	}
	var pop = el(doc, "div", {"class": "kb-popover", role: "dialog"}, [content]);
	this.root.appendChild(pop);
	var rootRect = this.root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
	var width = pop.offsetWidth, height = pop.offsetHeight;
	var left = Math.min(Math.max(8, a.left - rootRect.left), rootRect.width - width - 8);
	var top = a.bottom - rootRect.top + 6;
	if (top + height > rootRect.height - 8) {
		top = Math.max(8, rootRect.height - height - 8);
	}
	pop.style.left = left + "px";
	pop.style.top = top + "px";
	var outside = function(event) {
		if (!pop.contains(event.target) && !anchor.contains(event.target)) {
			self.closePopover();
		}
	};
	var keys = function(event) {
		if (event.key === "Escape") {
			self.closePopover();
		}
	};
	doc.addEventListener("pointerdown", outside, true);
	doc.addEventListener("keydown", keys);
	this.popover = {el: pop, key: key, cleanup: function() {
		doc.removeEventListener("pointerdown", outside, true);
		doc.removeEventListener("keydown", keys);
	}};
	return pop;
};

/*
Board settings: the board filter, the projects offered as buttons and the
column width. Written to the graph's settings in the store tiddler.
*/
methods.openBoardSettings = function() {
	var doc = this.document, self = this;
	var filter = el(doc, "input", {type: "text", "class": "kb-input", placeholder: "e.g. [tag[Project A]]", value: this.graph.boardFilter || ""});
	filter.addEventListener("change", function() { self.setBoardFilter(filter.value.trim()); });
	var projects = el(doc, "input", {type: "text", "class": "kb-input", placeholder: "Tags, e.g. [[Project A]] Website", value: this.graph.projects || ""});
	projects.addEventListener("change", function() {
		self.setGraphProperty("projects", projects.value.trim());
	});
	var width = el(doc, "input", {type: "range", min: "120", max: "520", step: "10", value: String(this.graph.columnWidth || 260)});
	var widthValue = el(doc, "span", {"class": "kb-range-value", text: (this.graph.columnWidth || 260) + " px"});
	width.addEventListener("input", function() {
		widthValue.textContent = width.value + " px";
		self.root.style.setProperty("--kb-column-width", width.value + "px");
		self.scheduleEdges();
	});
	width.addEventListener("change", function() { self.setGraphProperty("columnWidth", width.value); });
	var fields = el(doc, "input", {type: "text", "class": "kb-input", placeholder: "title", value: this.graph.fields === undefined ? "" : this.graph.fields});
	fields.addEventListener("change", function() { self.setGraphProperty("fields", fields.value.trim()); });
	var content = el(doc, "div", {"class": "kb-form"}, [
		el(doc, "strong", {text: "Board"}),
		field(doc, "Board filter", "Only cards passing this filter run are shown.", filter),
		field(doc, "Projects", "Tags shown as buttons above the board. Clicking one filters the board to it, and new cards get that tag.", projects),
		field(doc, "Fields on cards", "Default for columns without their own choice.", fields),
		field(doc, "Column width", null, el(doc, "div", {"class": "kb-range"}, [width, widthValue]))
	]);
	this.openPopover(content, this.settingsButton, "board");
};

/*
A column's settings: its value (renaming changes its cards), display
name, color, icon, how its cards look and which fields they show.
*/
methods.openColumnSettings = function(value, anchor) {
	var doc = this.document, self = this;
	var own = this.styles[value] || {};
	var style = this.styleOf(value);
	var patch = function(changes) {
		self.saveStyles(Model.patchStyle(self.styles, value, changes));
	};
	// Value: renaming changes the field on its cards.
	var name = el(doc, "input", {type: "text", "class": "kb-input", value: value});
	name.addEventListener("change", function() {
		var text = name.value.trim();
		if (text && text !== value) {
			self.closePopover();
			self.layout = self.computeLayout();
			self.commitEditing({kind: "column", value: value}, text);
		}
	});
	var label = el(doc, "input", {type: "text", "class": "kb-input", placeholder: value, value: own.label || ""});
	label.addEventListener("change", function() { patch({label: label.value.trim()}); });
	// Colors
	var colors = el(doc, "div", {"class": "kb-swatches"});
	Model.PALETTE.concat(["#6b7280"]).forEach(function(color) {
		var b = el(doc, "button", {"class": "kb-swatch" + (style.color === color ? " kb-on" : ""), type: "button", title: color});
		b.style.setProperty("--kb-swatch", color);
		b.addEventListener("click", function() { patch({color: color}); self.reopenColumnSettings(value); });
		colors.appendChild(b);
	});
	var custom = el(doc, "input", {type: "color", "class": "kb-color", value: /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : "#1c55ff", title: "Own color"});
	custom.addEventListener("change", function() { patch({color: custom.value}); self.reopenColumnSettings(value); });
	colors.appendChild(custom);
	// Icons
	var icons = el(doc, "div", {"class": "kb-icons"});
	var none = el(doc, "button", {"class": "kb-icon-choice" + (!own.icon ? " kb-on" : ""), type: "button", title: "No icon", text: "∅"});
	none.addEventListener("click", function() { patch({icon: ""}); self.reopenColumnSettings(value); });
	icons.appendChild(none);
	ICONS.forEach(function(title) {
		if (!self.wiki.getTiddler(title) && !self.wiki.isShadowTiddler(title)) {
			return;
		}
		var b = el(doc, "button", {"class": "kb-icon-choice" + (own.icon === title ? " kb-on" : ""), type: "button", title: title.replace("$:/core/images/", "")});
		b.innerHTML = self.wiki.renderTiddler("text/html", title);
		b.addEventListener("click", function() { patch({icon: title}); self.reopenColumnSettings(value); });
		icons.appendChild(b);
	});
	// View
	var view = el(doc, "select", {"class": "kb-input"});
	Model.VIEWS.forEach(function(v) {
		var option = el(doc, "option", {value: v, text: VIEW_LABELS[v]});
		view.appendChild(option);
	});
	view.value = style.view;
	view.addEventListener("change", function() { patch({view: view.value === "full" ? "" : view.value}); });
	// Fields
	var current = own.fields !== undefined ? Model.parseList(own.fields) : null;
	var effective = current || this.boardFields();
	var found = this.fieldsInColumn(value);
	var choices = FIELD_CHOICES.concat(found.filter(function(f) { return FIELD_CHOICES.indexOf(f) < 0; }));
	var checks = el(doc, "div", {"class": "kb-field-checks"});
	choices.forEach(function(f) {
		var box = el(doc, "input", {type: "checkbox"});
		box.checked = effective.indexOf(f) >= 0;
		box.addEventListener("change", function() {
			var next = (current || self.boardFields()).slice();
			if (box.checked) {
				next.indexOf(f) < 0 && next.push(f);
			} else {
				next = next.filter(function(x) { return x !== f; });
			}
			current = next;
			patch({fields: Model.stringifyList(next)});
		});
		checks.appendChild(el(doc, "label", {"class": "kb-check"}, [box, " " + f]));
	});
	var reset = el(doc, "button", {"class": "kb-textbtn", type: "button", text: "Use the board's fields"});
	reset.disabled = own.fields === undefined;
	reset.addEventListener("click", function() { patch({fields: null}); self.reopenColumnSettings(value); });
	var remove = el(doc, "button", {"class": "kb-textbtn kb-danger", type: "button", text: "Remove column", title: "The cards keep their value"});
	remove.addEventListener("click", function() {
		self.closePopover();
		self.writeValues("column", Model.removeValue(self.currentValues("column"), value));
		if (self.styles[value]) {
			self.saveStyles(Model.patchStyle(self.styles, value, {label: null, color: null, icon: null, view: null, fields: null}));
		}
	});
	var content = el(doc, "div", {"class": "kb-form kb-column-form"}, [
		el(doc, "strong", {text: "Column"}),
		field(doc, "Value", "What the cards' " + (this.columnField() || "field") + " says. Renaming changes it on the cards too.", name),
		field(doc, "Display name", null, label),
		field(doc, "Color", null, colors),
		field(doc, "Icon", null, icons),
		field(doc, "Cards", null, view),
		field(doc, "Fields on these cards", null, el(doc, "div", null, [checks, reset])),
		el(doc, "div", {"class": "kb-form-foot"}, [remove])
	]);
	this.columnSettingsAnchor = function() {
		var headers = self.grid.querySelectorAll(".kb-column-header");
		for (var i = 0; i < headers.length; i++) {
			if (headers[i].getAttribute("data-kb-value") === value) {
				return headers[i];
			}
		}
		return anchor;
	};
	this.openPopover(content, anchor, "column:" + value);
};

methods.reopenColumnSettings = function(value) {
	var self = this;
	this.closePopover();
	// After the board re-rendered with the new style.
	setTimeout(function() {
		if (!self.destroyed) {
			self.renderBoard();
			self.openColumnSettings(value, self.columnSettingsAnchor ? self.columnSettingsAnchor() : self.root);
		}
	}, 30);
};

methods.boardFields = function() {
	return Model.parseList(this.graph.fields === undefined ? "title" : this.graph.fields);
};

/*
Fields the cards in a column actually have, for the field choice.
*/
methods.fieldsInColumn = function(value) {
	var seen = Object.create(null), out = [];
	var layout = this.layout;
	if (!layout) {
		return out;
	}
	for (var key in layout.cells) {
		if (key.split("\u0000")[0] !== value) {
			continue;
		}
		var self = this;
		layout.cells[key].forEach(function(id) {
			var tiddler = self.wiki.getTiddler(id);
			if (tiddler) {
				Object.keys(tiddler.fields).forEach(function(f) {
					if (!seen[f] && f.indexOf("draft.") !== 0) {
						seen[f] = true;
						out.push(f);
					}
				});
			}
		});
	}
	return out.sort();
};

/*** Helpers ***/

function el(doc, tag, attrs, children) {
	var node = doc.createElement(tag);
	for (var name in attrs || {}) {
		if (name === "text") {
			node.textContent = attrs[name];
		} else if (attrs[name] !== undefined && attrs[name] !== null) {
			node.setAttribute(name, attrs[name]);
		}
	}
	(children || []).forEach(function(child) {
		if (child) {
			node.appendChild(typeof child === "string" ? doc.createTextNode(child) : child);
		}
	});
	return node;
}

function field(doc, label, hint, control) {
	return el(doc, "div", {"class": "kb-form-field"}, [
		el(doc, "div", {"class": "kb-form-label", text: label}),
		control,
		hint ? el(doc, "div", {"class": "kb-form-hint", text: hint}) : null
	]);
}

function iconButton(doc, symbol, title, onclick) {
	var b = el(doc, "button", {"class": "kb-iconbtn", type: "button", title: title, "aria-label": title, text: symbol});
	b.addEventListener("click", onclick);
	return b;
}

function remove(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
	}
}
