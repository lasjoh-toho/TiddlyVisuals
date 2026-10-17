/*\
title: $:/plugins/lasjoh-toho/kanban/lib/model.js
type: application/javascript
module-type: library

Pure data helpers for the Kanban engine. Nothing in here touches the DOM,
so it is safe to load (and test) under Node.js.

Where things live:

* A card's column and swimlane are values of fields of the card's own
  tiddler (by default `status`), so filters and other boards see them.
* Which fields decide columns and swimlanes, and the lists of their values,
  are graph properties, kept with the graph like all its other settings.
* The order of the cards is a title list in a field of the store tiddler
  (by default `kanban`).

\*/

"use strict";

// Column or swimlane for cards whose value is missing or not in the list.
var NONE = "";
exports.NONE = NONE;

var LIST_FIELDS = {tags: true, list: true};

function parseList(text) {
	return (text ? $tw.utils.parseStringArray(text) : null) || [];
}
exports.parseList = parseList;

exports.stringifyList = function(list) {
	return $tw.utils.stringifyList(list);
};

/*
Fields like `tags` hold several values; a card belongs to the first
column whose value is among them.
*/
exports.isListField = function(field) {
	return !!LIST_FIELDS[field];
};

/*
The value a card has for `field`, given the tiddler's `fields` (or
undefined for a missing tiddler) and the allowed `values` (may be empty
when they are derived from the cards).
*/
exports.cardValue = function(fields, field, values) {
	if (!field || !fields) {
		return NONE;
	}
	var raw = fields[field];
	if (exports.isListField(field)) {
		var list = Array.isArray(raw) ? raw : parseList(raw);
		if (values && values.length) {
			for (var i = 0; i < values.length; i++) {
				if (list.indexOf(values[i]) >= 0) {
					return values[i];
				}
			}
			return NONE;
		}
		return list.length ? list[0] : NONE;
	}
	if (raw === undefined || raw === null) {
		return NONE;
	}
	if (raw instanceof Date) {
		raw = $tw.utils.stringifyDate(raw);
	}
	return String(raw).trim();
};

/*
The configured values, or, when nothing is configured, every value the
cards have, sorted.
*/
exports.resolveValues = function(configured, found) {
	var list = parseList(configured);
	if (list.length) {
		return list;
	}
	var seen = Object.create(null), out = [];
	for (var i = 0; i < found.length; i++) {
		var value = found[i];
		if (value !== NONE && !seen[value]) {
			seen[value] = true;
			out.push(value);
		}
	}
	return out.sort(function(a, b) { return a.localeCompare(b); });
};

/*
Lays the cards out.

ids:     the cards, in the board's order
valueOf: function(id) -> {column, lane}
options: {columns, lanes (title lists, may be blank), hasLanes}

Returns {columns: [values], lanes: [values], cells: {key: [ids]}} where a
NONE entry is added in front of the columns (or lanes) only when some card
needs it. Use cellKey() to read cells.
*/
exports.layout = function(ids, valueOf, options) {
	options = options || {};
	var values = ids.map(valueOf);
	var columns = exports.resolveValues(options.columns, values.map(function(v) { return v.column; }));
	var lanes = options.hasLanes ?
		exports.resolveValues(options.lanes, values.map(function(v) { return v.lane; })) : [];
	var cells = Object.create(null);
	var noneColumn = false, noneLane = false;
	for (var i = 0; i < ids.length; i++) {
		var column = columns.indexOf(values[i].column) >= 0 ? values[i].column : NONE;
		var lane = NONE;
		if (options.hasLanes) {
			lane = lanes.indexOf(values[i].lane) >= 0 ? values[i].lane : NONE;
			noneLane = noneLane || lane === NONE;
		}
		noneColumn = noneColumn || column === NONE;
		var key = cellKey(column, lane);
		(cells[key] = cells[key] || []).push(ids[i]);
	}
	if (noneColumn || columns.length === 0) {
		columns.unshift(NONE);
	}
	if (options.hasLanes && (noneLane || lanes.length === 0)) {
		lanes.unshift(NONE);
	}
	if (!options.hasLanes) {
		lanes = [NONE];
	}
	return {columns: columns, lanes: lanes, cells: cells};
};

function cellKey(column, lane) {
	return column + "\u0000" + lane;
}
exports.cellKey = cellKey;

/*
Puts the board order into shape: titles of cards that are gone are kept
(they may come back), and cards not yet ordered are appended in the order
the graph lists them.
*/
exports.normalizeOrder = function(order, ids) {
	var seen = Object.create(null), out = [];
	order.forEach(function(id) {
		if (!seen[id]) {
			seen[id] = true;
			out.push(id);
		}
	});
	ids.forEach(function(id) {
		if (!seen[id]) {
			seen[id] = true;
			out.push(id);
		}
	});
	return out;
};

exports.sortByOrder = function(ids, order) {
	var rank = Object.create(null);
	order.forEach(function(id, i) { rank[id] = i; });
	return ids.slice().sort(function(a, b) {
		var ra = rank[a] === undefined ? Infinity : rank[a];
		var rb = rank[b] === undefined ? Infinity : rank[b];
		return ra === rb ? 0 : (ra < rb ? -1 : 1);
	});
};

/*
Moves `id` within the board `order` so that it sits where it was dropped:
`cell` lists the target cell's cards after the drop, including `id`.
*/
exports.placeInOrder = function(order, id, cell) {
	var index = cell.indexOf(id);
	var out = order.filter(function(other) { return other !== id; });
	if (index < 0 || cell.length === 1) {
		out.push(id);
		return out;
	}
	if (index + 1 < cell.length) {
		out.splice(out.indexOf(cell[index + 1]), 0, id);
	} else {
		out.splice(out.indexOf(cell[index - 1]) + 1, 0, id);
	}
	return out;
};

/*
The field changes that put a card with `fields` into `value` for `field`,
out of all of `values`. Returns {field: newValue} where newValue undefined
means "remove the field", or null when nothing changes.
*/
exports.assignValue = function(fields, field, value, values) {
	if (!field) {
		return null;
	}
	var changes = {};
	if (exports.isListField(field)) {
		var current = fields ? fields[field] : undefined;
		var list = Array.isArray(current) ? current.slice() : parseList(current);
		var next = list.filter(function(item) {
			return values.indexOf(item) < 0 && item !== value;
		});
		if (value !== NONE) {
			next.push(value);
		}
		if (next.join("\u0000") === list.join("\u0000")) {
			return null;
		}
		changes[field] = next.length ? next : undefined;
		return changes;
	}
	if (exports.cardValue(fields, field, values) === value) {
		return null;
	}
	changes[field] = value === NONE ? undefined : value;
	return changes;
};

/*** Editing the column and swimlane lists ***/

exports.insertValue = function(list, value, index) {
	var out = list.filter(function(v) { return v !== value && v !== NONE; });
	if (index === undefined || index < 0 || index > out.length) {
		index = out.length;
	}
	out.splice(index, 0, value);
	return out;
};

exports.renameValue = function(list, from, to) {
	var out = [];
	list.forEach(function(v) {
		var next = v === from ? to : v;
		if (next !== NONE && out.indexOf(next) < 0) {
			out.push(next);
		}
	});
	return out;
};

exports.removeValue = function(list, value) {
	return list.filter(function(v) { return v !== value && v !== NONE; });
};

exports.moveValue = function(list, value, delta) {
	var out = list.filter(function(v) { return v !== NONE; });
	var index = out.indexOf(value);
	var target = index + delta;
	if (index < 0 || target < 0 || target >= out.length) {
		return out;
	}
	out.splice(index, 1);
	out.splice(target, 0, value);
	return out;
};

/*
Graph properties are kept as a JSON object of strings in a field of the
graph tiddler (`graph.graph`). Returns the new JSON text.
*/
exports.setProperty = function(json, name, value) {
	var data;
	try {
		data = json ? JSON.parse(json) : {};
	} catch (e) {
		data = {};
	}
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		data = {};
	}
	if (value) {
		data[name] = value;
	} else {
		delete data[name];
	}
	return JSON.stringify(data);
};

/*** Column styles ***/

/*
How each column looks, kept as JSON in a field of the store tiddler
(`kanban-columns`), keyed by the column's value:

{ "Doing": { "label": "In progress", "color": "#e92727",
             "icon": "$:/core/images/options-button",
             "view": "collapsible", "fields": "title text" } }

view:   "full" (default), "collapsible" (title with a toggle, like a
        folded index card) or "compact" (title only)
fields: which fields cards in this column show; missing = board default
*/
var VIEWS = {full: true, collapsible: true, compact: true};
exports.VIEWS = ["full", "collapsible", "compact"];

// Colors given to columns that have none of their own, in order.
exports.PALETTE = ["#1c55ff", "#aad21e", "#ff8000", "#e92727", "#8925c5", "#03b0e2", "#e2a203", "#14a37f"];

exports.parseStyles = function(text) {
	var data;
	try {
		data = text ? JSON.parse(text) : {};
	} catch (e) {
		data = {};
	}
	var out = Object.create(null);
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		return out;
	}
	for (var value in data) {
		var entry = data[value], clean = {};
		if (!entry || typeof entry !== "object") {
			continue;
		}
		["label", "color", "icon", "fields"].forEach(function(key) {
			if (typeof entry[key] === "string") {
				clean[key] = entry[key];
			}
		});
		if (VIEWS[entry.view]) {
			clean.view = entry.view;
		}
		if (Object.keys(clean).length) {
			out[value] = clean;
		}
	}
	return out;
};

exports.stringifyStyles = function(styles) {
	var out = {};
	Object.keys(styles).sort().forEach(function(value) {
		if (styles[value] && Object.keys(styles[value]).length) {
			out[value] = styles[value];
		}
	});
	return Object.keys(out).length ? JSON.stringify(out) : "";
};

/*
Changes one column's style: keys of `patch` set to "" or null are
removed. Returns the new styles object.
*/
exports.patchStyle = function(styles, value, patch) {
	var out = exports.parseStyles(JSON.stringify(styles));
	var entry = out[value] || {};
	for (var key in patch) {
		if (patch[key] === null || patch[key] === undefined || (patch[key] === "" && key !== "fields")) {
			delete entry[key];
		} else {
			entry[key] = patch[key];
		}
	}
	if (Object.keys(entry).length) {
		out[value] = entry;
	} else {
		delete out[value];
	}
	return out;
};

exports.renameStyle = function(styles, from, to) {
	var out = exports.parseStyles(JSON.stringify(styles));
	if (out[from]) {
		out[to] = out[from];
		delete out[from];
	}
	return out;
};

/*
The style a column is drawn with: its own settings over the defaults
(a palette color by position, full cards).
*/
exports.columnStyle = function(styles, value, index) {
	var own = styles[value] || {};
	return {
		label: own.label || "",
		color: own.color || (value === NONE ? "" : exports.PALETTE[index % exports.PALETTE.length]),
		icon: own.icon || "",
		view: own.view || "full",
		fields: own.fields
	};
};

/*** Board filter and projects ***/

/*
The filter that selects a project, from its tag.
*/
exports.projectFilter = function(tag) {
	return "[tag[" + tag + "]]";
};

/*
Which project a board filter selects, if it is exactly a project filter.
*/
exports.activeProject = function(filter, projects) {
	for (var i = 0; i < projects.length; i++) {
		if ((filter || "").trim() === exports.projectFilter(projects[i])) {
			return projects[i];
		}
	}
	return null;
};

/*** Geometry for connections ***/

exports.clipToRect = function(rect, tx, ty, margin) {
	margin = margin || 0;
	var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
	var dx = tx - cx, dy = ty - cy;
	if (dx === 0 && dy === 0) {
		return {x: cx, y: cy};
	}
	var hw = rect.w / 2 + margin, hh = rect.h / 2 + margin;
	var scale = Math.min(
		dx !== 0 ? hw / Math.abs(dx) : Infinity,
		dy !== 0 ? hh / Math.abs(dy) : Infinity);
	scale = Math.min(scale, 1);
	return {x: cx + dx * scale, y: cy + dy * scale};
};
