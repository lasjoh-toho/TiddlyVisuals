/*\
title: $:/plugins/lasjoh-toho/kanban/lib/modal.js
type: application/javascript
module-type: library

The card viewer: a sheet as tall as the tiddler needs, up to the whole
screen. Edit and Close appear on hover; the card's column and swimlane
can be changed right there; links open in the viewer.

\*/

"use strict";

var Model = require("./model.js");

var MODAL_TEMPLATE = "$:/plugins/lasjoh-toho/kanban/templates/modal";
var NONE = Model.NONE;

var methods = exports.methods = {};

methods.openModal = function(title) {
	var doc = this.document, self = this;
	this.closeModal();
	var fs = doc.fullscreenElement;
	var host = fs && fs !== doc.documentElement ? fs : doc.body;
	var modal = {title: title, editing: false};
	modal.content = el(doc, "div", {"class": "kb-modal-content"});
	modal.fields = el(doc, "div", {"class": "kb-modal-fields"});
	modal.editButton = el(doc, "button", {"class": "kb-modal-btn", type: "button", title: "Edit the text"}, ["✎ ", el(doc, "span", {text: "Edit text"})]);
	modal.editButton.addEventListener("click", function() { self.setModalEditing(!modal.editing); });
	var story = el(doc, "button", {"class": "kb-modal-btn", type: "button", title: "Open in story river", text: "↗"});
	story.addEventListener("click", function() { var t = modal.title; self.closeModal(); self.navigate(t); });
	var close = el(doc, "button", {"class": "kb-modal-btn kb-modal-close", type: "button", title: "Close (Esc)"}, ["× ", el(doc, "span", {text: "Close"})]);
	close.addEventListener("click", function() { self.closeModal(); });
	modal.controls = el(doc, "div", {"class": "kb-modal-controls"}, [modal.editButton, story, close]);
	modal.sheet = el(doc, "div", {"class": "kb-modal-sheet", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1"}, [
		modal.controls, modal.content
	]);
	modal.el = el(doc, "div", {"class": "kb-modal"}, [modal.sheet]);
	modal.el.addEventListener("click", function(event) {
		if (event.target === modal.el) {
			self.closeModal();
		}
	});
	modal.el.addEventListener("keydown", function(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			if (modal.editing) {
				self.setModalEditing(false);
			} else {
				self.closeModal();
			}
		}
	});
	this.modal = modal;
	host.appendChild(modal.el);
	this.renderModal();
	modal.sheet.focus({preventScroll: true});
};

/*
Links inside the viewer open their target in the viewer.
*/
methods.modalParentWidget = function() {
	var self = this;
	var parent = Object.create(this.parentWidget);
	parent.dispatchEvent = function(event) {
		if (event.type === "tm-navigate" && event.navigateTo && self.modal) {
			self.openModal(event.navigateTo);
			return false;
		}
		if (event.type === "tm-edit-tiddler" && self.modal) {
			self.setModalEditing(true);
			return false;
		}
		if (event.type === "tm-close-tiddler" && self.modal) {
			self.closeModal();
			return false;
		}
		return self.parentWidget.dispatchEvent(event);
	};
	return parent;
};

methods.renderModal = function() {
	var modal = this.modal;
	if (!modal) {
		return;
	}
	clear(modal.content);
	modal.textBefore = this.wiki.getTiddlerText(modal.title);
	modal.widget = this.wiki.makeTranscludeWidget(MODAL_TEMPLATE, {
		document: this.document,
		parentWidget: this.modalParentWidget(),
		importPageMacros: true,
		mode: "block",
		variables: {
			currentTiddler: modal.title,
			"kanban-editing": modal.editing ? "yes" : "no"
		}
	});
	modal.widget.render(modal.content, null);
	modal.el.classList.toggle("kb-modal-editing", modal.editing);
	modal.editButton.lastChild.textContent = modal.editing ? "Done" : "Edit text";
	modal.editButton.title = modal.editing ? "Finish editing" : "Edit the text";
	this.renderModalFields();
};

/*
The card's fields, editable right away: its column and swimlane, and the
board's fields chosen for the viewer. A field with options is a choice.
*/
methods.renderModalFields = function() {
	var modal = this.modal, doc = this.document, self = this;
	if (!modal) {
		return;
	}
	var slot = modal.content.querySelector(".kb-modal-fields-slot");
	if (slot && modal.fields.parentNode !== slot) {
		slot.appendChild(modal.fields);
	}
	// Keep the field being typed in.
	var active = doc.activeElement && modal.fields.contains(doc.activeElement) ? doc.activeElement.getAttribute("data-kb-field") : null;
	clear(modal.fields);
	var title = modal.title;
	var tiddler = this.wiki.getTiddler(title);
	var fields = tiddler ? tiddler.fields : undefined;
	var editable = this.isEditable();
	var row = function(name, control) {
		control.setAttribute("data-kb-field", name);
		control.disabled = !editable;
		modal.fields.appendChild(el(doc, "label", {"class": "kb-modal-field"}, [
			el(doc, "span", {"class": "kb-modal-field-name", text: name}), control
		]));
	};
	var choice = function(values, current, labelOf) {
		var sel = el(doc, "select", {"class": "kb-modal-input"});
		if (values.indexOf(current) < 0) {
			values = [current].concat(values);
		}
		values.forEach(function(v) {
			sel.appendChild(el(doc, "option", {value: v, text: labelOf(v)}));
		});
		sel.value = current;
		return sel;
	};
	var columnField = this.columnField(), laneField = this.laneField();
	var place = this.placeOf(title);
	if (columnField && this.layout) {
		var columns = this.layout.columns.filter(function(c) { return c !== NONE; });
		var colSelect = choice(columns.concat([NONE]), place.column, function(v) {
			return v === NONE ? "—" : self.valueLabel("column", v);
		});
		colSelect.addEventListener("change", function() {
			self.assignCell(title, colSelect.value, self.placeOf(title).lane);
		});
		row(columnField, colSelect);
		var color = this.styleOf(place.column).color;
		colSelect.style.setProperty("--kb-col", color || "var(--kb-muted)");
		colSelect.classList.add("kb-modal-column");
	}
	if (laneField && this.layout) {
		var lanes = this.layout.lanes.filter(function(l) { return l !== NONE; });
		var laneSelect = choice([NONE].concat(lanes), place.lane, function(v) {
			return self.valueLabel("lane", v);
		});
		laneSelect.addEventListener("change", function() {
			self.assignCell(title, self.placeOf(title).column, laneSelect.value);
		});
		row(laneField, laneSelect);
	}
	this.viewerFields().forEach(function(def) {
		var name = def.name, control;
		var text = Model.fieldText(fields, name);
		if (def.options) {
			control = choice([""].concat(def.options), text, function(v) { return v || "—"; });
		} else {
			control = el(doc, "input", {type: "text", "class": "kb-modal-input", value: text,
				placeholder: name === "tags" ? "[[tag one]] tag2" : ""});
			control.addEventListener("keydown", function(event) {
				if (event.key === "Enter") {
					event.preventDefault();
					control.blur();
				}
			});
		}
		control.addEventListener("change", function() {
			var value = control.value.trim();
			var changes = {};
			if (Model.isListField(name)) {
				var list = Model.parseList(value);
				changes[name] = list.length ? list : undefined;
			} else {
				changes[name] = value || undefined;
			}
			self.updateTiddler(title, changes);
		});
		row(name, control);
	});
	modal.fields.style.display = modal.fields.firstChild ? "" : "none";
	if (active) {
		var again = modal.fields.querySelector("[data-kb-field='" + active.replace(/'/g, "\\'") + "']");
		again && again.focus();
	}
};

/*
Fields the viewer shows besides the column and swimlane.
*/
methods.viewerFields = function() {
	var skip = [this.columnField(), this.laneField(), "title", "text"];
	return this.fieldDefs.filter(function(def) {
		return def.viewer !== false && skip.indexOf(def.name) < 0;
	});
};

methods.placeOf = function(id) {
	var tiddler = this.wiki.getTiddler(id);
	var fields = tiddler ? tiddler.fields : undefined;
	var layout = this.layout || {columns: [], lanes: []};
	var columns = layout.columns.filter(function(c) { return c !== NONE; });
	var lanes = layout.lanes.filter(function(l) { return l !== NONE; });
	var column = Model.cardValue(fields, this.columnField(), columns);
	var lane = this.laneField() ? Model.cardValue(fields, this.laneField(), lanes) : NONE;
	return {
		column: columns.indexOf(column) >= 0 ? column : NONE,
		lane: lanes.indexOf(lane) >= 0 ? lane : NONE
	};
};

methods.setModalEditing = function(editing) {
	var modal = this.modal;
	if (!modal || modal.editing === editing) {
		return;
	}
	if (!editing) {
		this.touchModalTiddler();
	}
	modal.editing = editing;
	this.renderModal();
	if (editing) {
		var area = modal.content.querySelector("textarea, input");
		area && area.focus();
	}
};

/*
Editing in the viewer writes straight to the tiddler; once done, stamp it
as modified like the regular editor would.
*/
methods.touchModalTiddler = function() {
	var modal = this.modal;
	if (!modal || !modal.editing) {
		return;
	}
	var tiddler = this.wiki.getTiddler(modal.title);
	if (tiddler && tiddler.fields.text !== modal.textBefore) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, this.wiki.getModificationFields()));
	}
};

methods.refreshModal = function(changes) {
	if (this.modal && this.modal.widget) {
		this.modal.widget.refresh(changes);
		if (changes[this.modal.title] || (this.graph.store && changes[this.graph.store]) ||
			!this.modal.content.contains(this.modal.fields)) {
			this.renderModalFields();
		}
	}
};

methods.closeModal = function() {
	var modal = this.modal;
	if (modal) {
		this.touchModalTiddler();
		this.modal = null;
		remove(modal.el);
		if (!this.destroyed) {
			this.root.focus({preventScroll: true});
		}
	}
};

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

function clear(node) {
	while (node.firstChild) {
		node.removeChild(node.firstChild);
	}
}

function remove(node) {
	if (node && node.parentNode) {
		node.parentNode.removeChild(node);
	}
}
