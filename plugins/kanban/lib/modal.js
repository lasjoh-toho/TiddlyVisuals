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
	modal.place = el(doc, "div", {"class": "kb-modal-place"});
	modal.editButton = el(doc, "button", {"class": "kb-modal-btn", type: "button", title: "Edit this tiddler"}, ["✎ ", el(doc, "span", {text: "Edit"})]);
	modal.editButton.addEventListener("click", function() { self.setModalEditing(!modal.editing); });
	var story = el(doc, "button", {"class": "kb-modal-btn", type: "button", title: "Open in story river", text: "↗"});
	story.addEventListener("click", function() { var t = modal.title; self.closeModal(); self.navigate(t); });
	var close = el(doc, "button", {"class": "kb-modal-btn kb-modal-close", type: "button", title: "Close (Esc)"}, ["× ", el(doc, "span", {text: "Close"})]);
	close.addEventListener("click", function() { self.closeModal(); });
	modal.controls = el(doc, "div", {"class": "kb-modal-controls"}, [modal.editButton, story, close]);
	modal.sheet = el(doc, "div", {"class": "kb-modal-sheet", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1"}, [
		modal.controls, modal.place, modal.content
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
	modal.editButton.lastChild.textContent = modal.editing ? "Done" : "Edit";
	modal.editButton.title = modal.editing ? "Finish editing" : "Edit this tiddler";
	this.renderModalPlace();
};

/*
Column and swimlane of the card in the viewer, as choices that move it.
*/
methods.renderModalPlace = function() {
	var modal = this.modal, doc = this.document, self = this;
	clear(modal.place);
	if (!this.nodes[modal.title] || !this.layout) {
		return;
	}
	var place = this.placeOf(modal.title);
	var select = function(kind, values, current) {
		var sel = el(doc, "select", {"class": "kb-place-select", disabled: self.isEditable() ? null : "disabled"});
		values.forEach(function(v) {
			sel.appendChild(el(doc, "option", {value: v, text: self.valueLabel(kind, v)}));
		});
		sel.value = current;
		sel.addEventListener("change", function() {
			var now = self.placeOf(modal.title);
			self.assignCell(modal.title, kind === "column" ? sel.value : now.column, kind === "lane" ? sel.value : now.lane);
			self.scheduleRender();
		});
		return sel;
	};
	var columns = this.layout.columns.slice();
	if (columns.indexOf(place.column) < 0) {
		columns.unshift(place.column);
	}
	var color = this.styleOf(place.column).color;
	var dot = el(doc, "span", {"class": "kb-place-dot"});
	dot.style.background = color || "var(--kb-muted)";
	modal.place.appendChild(dot);
	modal.place.appendChild(select("column", columns, place.column));
	if (this.laneField()) {
		var lanes = this.layout.lanes.slice();
		if (lanes.indexOf(place.lane) < 0) {
			lanes.unshift(place.lane);
		}
		modal.place.appendChild(el(doc, "span", {"class": "kb-place-sep", text: "·"}));
		modal.place.appendChild(select("lane", lanes, place.lane));
	}
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
		if (changes[this.modal.title]) {
			this.renderModalPlace();
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
