/*\
title: $:/plugins/lasjoh-toho/kanban/lib/ui.js
type: application/javascript
module-type: library

The Kanban board's chrome: the toolbar with the search and its saved
searches, board settings and fullscreen, and the column settings popover.

\*/

"use strict";

var Model = require("./model.js");

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
// Always offered for cards, before the board's own fields.
var BUILTIN_FIELDS = ["title", "text"];
// Never offered as columns or swimlanes.
var NOT_GROUPING = {title: true, text: true, created: true, modified: true, creator: true, modifier: true, revision: true, bag: true, type: true};

var COG = "$:/core/images/options-button";
var LENS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

// What was searched, per board, so it survives the board being rebuilt.
var searches = Object.create(null);

var methods = exports.methods = {};

/*** Toolbar ***/

methods.buildToolbar = function() {
	var doc = this.document, self = this;
	var lens = el(doc, "span", {"class": "kb-search-lens"});
	lens.innerHTML = LENS;
	this.searchInput = el(doc, "input", {type: "search", "class": "kb-search", placeholder: "Search", "aria-label": "Search the board"});
	this.searchInput.addEventListener("input", function() {
		self.setSearch(self.searchInput.value);
	});
	this.searchInput.addEventListener("keydown", function(event) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			self.openSavedSearches();
		}
	});
	this.savedButton = el(doc, "button", {"class": "kb-saved-toggle", type: "button", title: "Saved searches", "aria-label": "Saved searches", text: "▾"});
	this.savedButton.addEventListener("click", function() { self.openSavedSearches(); });
	this.searchWrap = el(doc, "div", {"class": "kb-search-wrap"}, [lens, this.searchInput, this.savedButton]);
	this.filterBadge = el(doc, "button", {"class": "kb-filter-badge", type: "button", title: "Board filter (click to change)"});
	this.filterBadge.addEventListener("click", function() { self.openBoardSettings(); });
	this.settingsButton = iconButton(doc, "", "Board settings: filter, columns, swimlanes, fields", function() {
		self.openBoardSettings();
	});
	this.settingsButton.innerHTML = this.wiki.renderTiddler("text/html", COG, {parseAsInline: true});
	this.fullscreenButton = iconButton(doc, "⛶", "Fullscreen", function() {
		self.toggleFullscreen();
	});
	this.toolbar = el(doc, "div", {"class": "kb-toolbar"}, [
		this.searchWrap,
		this.filterBadge,
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

/*
Only touches what changed, so a click on the toolbar is never lost to a
rebuild.
*/
methods.updateToolbar = function() {
	var filter = (this.graph.boardFilter || "").trim();
	if (this.filterBadge.textContent !== filter) {
		this.filterBadge.textContent = filter;
	}
	this.filterBadge.style.display = filter ? "" : "none";
	this.settingsButton.style.display = this.canConfigure() ? "" : "none";
	this.searchWrap.classList.toggle("kb-searching", !!this.search);
	if (this.searchInput.value.trim() !== this.search && this.document.activeElement !== this.searchInput) {
		this.searchInput.value = this.search;
	}
};

/*** Searching ***/

methods.searchKey = function() {
	return this.graph.store || "";
};

methods.restoreSearch = function() {
	var saved = searches[this.searchKey()] || "";
	if (this.searchInput && saved !== this.search) {
		this.search = saved;
		this.searchInput.value = saved;
		this.computeMatches();
	}
};

methods.setSearch = function(text) {
	this.search = (text || "").trim();
	searches[this.searchKey()] = this.search;
	if (this.searchInput.value.trim() !== this.search) {
		this.searchInput.value = this.search;
	}
	this.computeMatches();
	this.scheduleRender();
};

methods.savedSearches = function() {
	return Model.parseList(this.graph.projects);
};

/*
The menu of saved searches: pick one to search for it, − forgets it, and
+ saves what is searched now.
*/
methods.openSavedSearches = function() {
	var doc = this.document, self = this;
	var saved = this.savedSearches();
	var list = el(doc, "div", {"class": "kb-saved-list", role: "menu"});
	var item = function(label, value, removable) {
		var pick = el(doc, "button", {"class": "kb-saved-item" + (self.search === value ? " kb-on" : ""), type: "button", role: "menuitem", text: label});
		pick.addEventListener("click", function() {
			self.closePopover();
			self.setSearch(value);
		});
		var row = el(doc, "div", {"class": "kb-saved-row"}, [pick]);
		if (removable && self.canConfigure()) {
			var minus = el(doc, "button", {"class": "kb-saved-remove", type: "button", title: "Remove “" + value + "” from the list", text: "−"});
			minus.addEventListener("click", function() {
				self.setGraphProperty("projects", Model.stringifyList(Model.removeValue(self.savedSearches(), value)));
				self.reopenSavedSearches();
			});
			row.appendChild(minus);
		}
		list.appendChild(row);
	};
	item("All cards", "", false);
	saved.forEach(function(value) { item(value, value, true); });
	var content = el(doc, "div", {"class": "kb-saved"}, [list]);
	if (this.canConfigure()) {
		var current = this.search;
		var plus = el(doc, "button", {"class": "kb-saved-add", type: "button",
			text: current ? "+ Save “" + current + "”" : "+ Type a search to save it"});
		plus.disabled = !current || saved.indexOf(current) >= 0;
		plus.addEventListener("click", function() {
			self.setGraphProperty("projects", Model.stringifyList(Model.insertValue(self.savedSearches(), current)));
			self.reopenSavedSearches();
		});
		content.appendChild(plus);
	}
	this.openPopover(content, this.searchWrap, "saved");
};

methods.reopenSavedSearches = function() {
	var self = this;
	this.closePopover();
	setTimeout(function() {
		!self.destroyed && self.openSavedSearches();
	}, 0);
};

/*
A saved search that names a tag shows that tag's cards (a project), and
new cards get the tag.
*/
methods.currentProject = function() {
	var search = this.search;
	if (search && this.savedSearches().indexOf(search) >= 0 && this.wiki.getTiddlersWithTag(search).length) {
		return search;
	}
	return null;
};

/*
Which cards pass the board filter and the search. The board filter is a
TiddlyWiki filter run; the search is a project (see above) or words that
must all appear in the card's fields.
*/
methods.computeMatches = function() {
	var filter = (this.graph.boardFilter || "").trim();
	this.filterSet = null;
	this.filterKey = filter;
	if (filter) {
		var titles = [];
		try {
			titles = this.wiki.filterTiddlers(filter, this.parentWidget);
		} catch (e) {}
		this.filterSet = toSet(titles);
	}
	var project = this.currentProject();
	this.projectSet = project ? toSet(this.wiki.getTiddlersWithTag(project)) : null;
	this.searchWords = this.search && !project ? this.search.toLowerCase().split(/\s+/) : null;
};

methods.cardShown = function(id) {
	if ((this.graph.boardFilter || "").trim() !== (this.filterKey || "")) {
		this.computeMatches();
	}
	if (this.filterSet && !this.filterSet[id]) {
		return false;
	}
	if (this.projectSet) {
		return !!this.projectSet[id];
	}
	if (this.searchWords) {
		var tiddler = this.wiki.getTiddler(id);
		var hay = [id, this.nodes[id] && this.nodes[id].label || ""];
		if (tiddler) {
			for (var f in tiddler.fields) {
				hay.push(Model.fieldText(tiddler.fields, f));
			}
		}
		hay = hay.join("\n").toLowerCase();
		return this.searchWords.every(function(w) { return hay.indexOf(w) >= 0; });
	}
	return true;
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
	var pop = el(doc, "div", {"class": "kb-popover kb-popover-" + key.split(":")[0], role: "dialog"}, [content]);
	this.root.appendChild(pop);
	var rootRect = this.root.getBoundingClientRect(), a = anchor.getBoundingClientRect();
	var width = pop.offsetWidth, height = pop.offsetHeight;
	var left = Math.min(Math.max(8, a.left - rootRect.left), rootRect.width - width - 8);
	var top = a.bottom - rootRect.top + 4;
	if (top + height > rootRect.height - 8) {
		top = Math.max(8, rootRect.height - height - 8);
	}
	pop.style.left = Math.max(8, left) + "px";
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

/*** Board settings ***/

/*
Board settings: the board filter, which fields make the columns and the
swimlanes, the board's fields (with their options, and where they show)
and the column width. Kept with the graph in the store tiddler.
*/
methods.openBoardSettings = function() {
	var doc = this.document, self = this;
	if (!this.canConfigure()) {
		return;
	}
	var filter = el(doc, "input", {type: "text", "class": "kb-input", placeholder: "e.g. [tag[Project A]]", value: this.graph.boardFilter || ""});
	filter.addEventListener("change", function() { self.setBoardFilter(filter.value.trim()); });
	// Which fields make columns and swimlanes
	var choices = this.groupingFields();
	var columnSelect = el(doc, "select", {"class": "kb-input"});
	choices.forEach(function(f) { columnSelect.appendChild(el(doc, "option", {value: f, text: f})); });
	columnSelect.value = this.columnField();
	// Another field has other values: its options, or those the cards have.
	var optionsOf = function(name) {
		var def = self.fieldDefs.filter(function(d) { return d.name === name; })[0];
		return def && def.options ? Model.stringifyList(def.options) : "";
	};
	columnSelect.addEventListener("change", function() {
		self.setGraphProperty("columns", optionsOf(columnSelect.value));
		self.setGraphProperty("columnField", columnSelect.value);
		self.reopenBoardSettings();
	});
	var laneSelect = el(doc, "select", {"class": "kb-input"});
	laneSelect.appendChild(el(doc, "option", {value: "", text: "— no swimlanes —"}));
	choices.forEach(function(f) { laneSelect.appendChild(el(doc, "option", {value: f, text: f})); });
	laneSelect.value = this.laneField();
	laneSelect.addEventListener("change", function() {
		self.setGraphProperty("lanes", optionsOf(laneSelect.value));
		self.setGraphProperty("laneField", laneSelect.value);
		self.reopenBoardSettings();
	});
	var width = el(doc, "input", {type: "range", min: "120", max: "520", step: "10", value: String(this.graph.columnWidth || 260)});
	var widthValue = el(doc, "span", {"class": "kb-range-value", text: (this.graph.columnWidth || 260) + " px"});
	width.addEventListener("input", function() {
		widthValue.textContent = width.value + " px";
		self.root.style.setProperty("--kb-column-width", width.value + "px");
		self.scheduleEdges();
	});
	width.addEventListener("change", function() { self.setGraphProperty("columnWidth", width.value); });
	var content = el(doc, "div", {"class": "kb-form kb-board-form"}, [
		el(doc, "strong", {text: "Board"}),
		field(doc, "Board filter", "Only cards passing this filter run are on the board, e.g. one project's tag.", filter),
		el(doc, "div", {"class": "kb-form-pair"}, [
			field(doc, "Columns from", null, columnSelect),
			field(doc, "Swimlanes from", null, laneSelect)
		]),
		field(doc, "Fields", "Options: values to choose from, separated by commas. Card: shown on cards. Viewer: shown, and editable, when a card is opened.", this.renderFieldTable()),
		field(doc, "Column width", null, el(doc, "div", {"class": "kb-range"}, [width, widthValue]))
	]);
	this.openPopover(content, this.settingsButton, "board");
};

methods.reopenBoardSettings = function() {
	var self = this;
	this.closePopover();
	setTimeout(function() {
		!self.destroyed && self.openBoardSettings();
	}, 30);
};

/*
One row per field: name, options, on cards, in the viewer, remove; and a
row to add a field.
*/
methods.renderFieldTable = function() {
	var doc = this.document, self = this;
	var table = el(doc, "div", {"class": "kb-field-table"});
	table.appendChild(el(doc, "div", {"class": "kb-field-row kb-field-head"}, [
		el(doc, "span", {text: "Field"}), el(doc, "span", {text: "Options"}),
		el(doc, "span", {text: "Card"}), el(doc, "span", {text: "Viewer"}), el(doc, "span")
	]));
	var cardFields = this.boardFields();
	var toggleCard = function(name, on) {
		var next = self.boardFields().filter(function(f) { return f !== name; });
		on && next.push(name);
		self.setGraphProperty("fields", Model.stringifyList(next));
	};
	var cardBox = function(name) {
		var box = el(doc, "input", {type: "checkbox", title: "Show on cards"});
		box.checked = cardFields.indexOf(name) >= 0;
		box.addEventListener("change", function() { toggleCard(name, box.checked); });
		return box;
	};
	BUILTIN_FIELDS.forEach(function(name) {
		table.appendChild(el(doc, "div", {"class": "kb-field-row kb-field-builtin"}, [
			el(doc, "span", {"class": "kb-fdef-name", text: name}),
			el(doc, "span", {"class": "kb-form-hint", text: name === "title" ? "the card's heading" : "the card's text"}),
			cardBox(name), el(doc, "span"), el(doc, "span")
		]));
	});
	this.boardFieldDefs().forEach(function(def) {
		var name = def.name;
		var grouping = name === self.columnField() ? "columns" : (name === self.laneField() ? "swimlanes" : null);
		var options = el(doc, "input", {type: "text", "class": "kb-input kb-input-small",
			placeholder: grouping ? "the " + grouping : "free text", value: (def.options || []).join(", ")});
		if (grouping) {
			options.disabled = true;
			options.title = "Its values are the board's " + grouping;
		}
		options.addEventListener("change", function() {
			self.saveFieldDefs(Model.patchFieldDef(self.fieldDefs, name, {options: Model.parseOptions(options.value)}));
		});
		var viewer = el(doc, "input", {type: "checkbox", title: "Show and edit in the card viewer"});
		viewer.checked = def.viewer !== false;
		viewer.addEventListener("change", function() {
			self.saveFieldDefs(Model.patchFieldDef(self.fieldDefs, name, {viewer: viewer.checked}));
		});
		var removeButton = el(doc, "button", {"class": "kb-tool", type: "button", title: "Remove from the board's fields (the cards keep it)", text: "×"});
		removeButton.addEventListener("click", function() {
			self.saveFieldDefs(Model.patchFieldDef(self.fieldDefs, name, null));
			cardFields.indexOf(name) >= 0 && toggleCard(name, false);
			self.reopenBoardSettings();
		});
		if (grouping) {
			removeButton.disabled = true;
		}
		table.appendChild(el(doc, "div", {"class": "kb-field-row"}, [
			el(doc, "span", {"class": "kb-fdef-name", text: name}), options, cardBox(name), viewer, removeButton
		]));
	});
	// Add a field
	var known = this.fieldsOnCards().filter(function(f) {
		return BUILTIN_FIELDS.indexOf(f) < 0 && !self.boardFieldDefs().some(function(d) { return d.name === f; });
	});
	var listId = "kb-fields-" + Math.random().toString(36).slice(2);
	var datalist = el(doc, "datalist", {id: listId});
	known.forEach(function(f) { datalist.appendChild(el(doc, "option", {value: f})); });
	var name = el(doc, "input", {type: "text", "class": "kb-input kb-input-small", placeholder: "new field, e.g. priority", list: listId});
	var add = function() {
		var text = name.value.trim().toLowerCase();
		if (text && $tw.utils.isValidFieldName(text)) {
			self.saveFieldDefs(Model.patchFieldDef(self.fieldDefs, text, {}));
			self.reopenBoardSettings();
		} else if (text) {
			name.setCustomValidity("Not a valid field name");
			name.reportValidity();
		}
	};
	name.addEventListener("keydown", function(event) {
		if (event.key === "Enter") {
			event.preventDefault();
			add();
		}
	});
	var addButton = el(doc, "button", {"class": "kb-textbtn", type: "button", text: "+ Add"});
	addButton.addEventListener("click", add);
	table.appendChild(el(doc, "div", {"class": "kb-field-add"}, [name, datalist, addButton]));
	return table;
};

/*
The board's fields: the ones defined for it, and the fields that make
columns and swimlanes, which always belong to it.
*/
methods.boardFieldDefs = function() {
	var defs = this.fieldDefs.slice();
	var names = defs.map(function(d) { return d.name; });
	var add = function(name) {
		if (name && names.indexOf(name) < 0) {
			names.unshift(name);
			defs.unshift({name: name});
		}
	};
	add(this.laneField());
	add(this.columnField());
	return defs;
};

/*
Fields that can make columns or swimlanes.
*/
methods.groupingFields = function() {
	var out = [];
	var add = function(f) {
		if (f && !NOT_GROUPING[f] && out.indexOf(f) < 0) {
			out.push(f);
		}
	};
	add(this.columnField());
	add(this.laneField());
	this.fieldDefs.forEach(function(d) { add(d.name); });
	this.fieldsOnCards().forEach(add);
	return out;
};

/*
Every field the board's cards have.
*/
methods.fieldsOnCards = function() {
	var seen = Object.create(null), out = [];
	for (var id in this.nodes) {
		var tiddler = this.wiki.getTiddler(id);
		if (tiddler) {
			for (var f in tiddler.fields) {
				if (!seen[f] && f.indexOf("draft.") !== 0) {
					seen[f] = true;
					out.push(f);
				}
			}
		}
	}
	return out.sort();
};

methods.boardFields = function() {
	return Model.parseList(this.graph.fields === undefined ? "title" : this.graph.fields);
};

/*** Column settings ***/

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
		b.innerHTML = self.wiki.renderTiddler("text/html", title, {parseAsInline: true});
		b.addEventListener("click", function() { patch({icon: title}); self.reopenColumnSettings(value); });
		icons.appendChild(b);
	});
	// View
	var view = el(doc, "select", {"class": "kb-input"});
	Model.VIEWS.forEach(function(v) {
		view.appendChild(el(doc, "option", {value: v, text: VIEW_LABELS[v]}));
	});
	view.value = style.view;
	view.addEventListener("change", function() { patch({view: view.value === "full" ? "" : view.value}); });
	// Fields: the board's, and any the cards in this column have.
	var current = own.fields !== undefined ? Model.parseList(own.fields) : null;
	var effective = current || this.boardFields();
	var choices = BUILTIN_FIELDS.slice();
	var addChoice = function(f) {
		choices.indexOf(f) < 0 && choices.push(f);
	};
	this.boardFieldDefs().forEach(function(d) { addChoice(d.name); });
	effective.forEach(addChoice);
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
	var removeButton = el(doc, "button", {"class": "kb-textbtn kb-danger", type: "button", text: "Remove column", title: "The cards keep their value"});
	removeButton.addEventListener("click", function() {
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
		field(doc, "Fields on these cards", "Add more fields in the board settings (⚙ at the top).", el(doc, "div", null, [checks, reset])),
		el(doc, "div", {"class": "kb-form-foot"}, [removeButton])
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

/*** Helpers ***/

function toSet(list) {
	var set = Object.create(null);
	list.forEach(function(t) { set[t] = true; });
	return set;
}

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
