/*\

Tests the data model behind the Kanban engine, and how it reads and
writes the fields of the cards' tiddlers.

\*/

describe("Kanban", function() {

var Model = require("$:/plugins/lasjoh-toho/kanban/lib/model.js");
var Kanban = $tw.modules.getModulesByTypeAsHashmap("graphengine").Kanban;

// An engine without any DOM, enough for the methods that only touch data.
function engine(wiki, graph, nodes) {
	var e = Object.create(Kanban);
	e.wiki = wiki;
	e.graph = graph || {};
	e.nodes = Object.create(null);
	(nodes || []).forEach(function(id) { e.nodes[id] = {}; });
	e.order = [];
	e.scheduleRender = function() {};
	return e;
}

it("declares itself as a graph engine", function() {
	expect(Kanban).toBeDefined();
	expect(Kanban.properties.graph.columnField.default).toBe("status");
	expect(Kanban.properties.graph.drop.variables).toEqual(["dropTiddler"]);
	expect(Kanban.properties.nodes.delete.variables).toEqual([]);
});

it("reads a card's value from plain and list fields", function() {
	expect(Model.cardValue({status: " Doing "}, "status", [])).toBe("Doing");
	expect(Model.cardValue({}, "status", [])).toBe(Model.NONE);
	expect(Model.cardValue(undefined, "status", [])).toBe(Model.NONE);
	expect(Model.cardValue({tags: ["Task", "Done", "Doing"]}, "tags", ["Doing", "Done"])).toBe("Doing");
	expect(Model.cardValue({tags: ["Task"]}, "tags", ["Doing", "Done"])).toBe(Model.NONE);
	expect(Model.cardValue({tags: "Task [[In review]]"}, "tags", [])).toBe("Task");
});

it("lays cards out in columns and swimlanes", function() {
	var values = {
		A: {column: "Done", lane: "Jo"},
		B: {column: "To do", lane: "Kim"},
		C: {column: "Elsewhere", lane: "Jo"},
		D: {column: "To do", lane: ""}
	};
	var valueOf = function(id) { return values[id]; };
	var layout = Model.layout(["A", "B", "C", "D"], valueOf, {columns: "[[To do]] Done"});
	expect(layout.columns).toEqual([Model.NONE, "To do", "Done"]);
	expect(layout.lanes).toEqual([Model.NONE]);
	expect(layout.cells[Model.cellKey("To do", Model.NONE)]).toEqual(["B", "D"]);
	expect(layout.cells[Model.cellKey(Model.NONE, Model.NONE)]).toEqual(["C"]);
	// Derived columns, and swimlanes
	layout = Model.layout(["A", "B", "C", "D"], valueOf, {hasLanes: true, lanes: "Kim Jo"});
	expect(layout.columns).toEqual(["Done", "Elsewhere", "To do"]);
	expect(layout.lanes).toEqual([Model.NONE, "Kim", "Jo"]);
	expect(layout.cells[Model.cellKey("To do", "Kim")]).toEqual(["B"]);
	expect(layout.cells[Model.cellKey("To do", Model.NONE)]).toEqual(["D"]);
	// An empty board still has somewhere to put cards
	expect(Model.layout([], valueOf, {}).columns).toEqual([Model.NONE]);
});

it("keeps the order of the cards", function() {
	var order = Model.normalizeOrder(["C", "gone", "A", "C"], ["A", "B", "C"]);
	expect(order).toEqual(["C", "gone", "A", "B"]);
	expect(Model.sortByOrder(["A", "B", "C", "new"], order)).toEqual(["C", "A", "B", "new"]);
	// Dropped before another card
	expect(Model.placeInOrder(["A", "B", "C", "D"], "D", ["B", "D", "C"])).toEqual(["A", "B", "D", "C"]);
	// Dropped at the end of a cell
	expect(Model.placeInOrder(["D", "A", "B", "C"], "D", ["A", "C", "D"])).toEqual(["A", "B", "C", "D"]);
	// Alone in its cell
	expect(Model.placeInOrder(["A", "B"], "A", ["A"])).toEqual(["B", "A"]);
});

it("computes field changes for a move", function() {
	expect(Model.assignValue({status: "To do"}, "status", "Done", [])).toEqual({status: "Done"});
	expect(Model.assignValue({status: "Done"}, "status", "Done", [])).toBe(null);
	expect(Model.assignValue({status: "Done"}, "status", Model.NONE, [])).toEqual({status: undefined});
	expect(Model.assignValue(undefined, "status", "Done", [])).toEqual({status: "Done"});
	var columns = ["To do", "Done"];
	expect(Model.assignValue({tags: ["Task", "To do"]}, "tags", "Done", columns)).toEqual({tags: ["Task", "Done"]});
	expect(Model.assignValue({tags: ["Task", "Done"]}, "tags", "Done", columns)).toBe(null);
	expect(Model.assignValue({tags: ["To do"]}, "tags", Model.NONE, columns)).toEqual({tags: undefined});
	expect(Model.assignValue({}, "", "Done", columns)).toBe(null);
});

it("edits the lists of columns and swimlanes", function() {
	var list = ["To do", "Doing", "Done"];
	expect(Model.insertValue(list, "Review")).toEqual(["To do", "Doing", "Done", "Review"]);
	expect(Model.insertValue(list, "Done", 0)).toEqual(["Done", "To do", "Doing"]);
	expect(Model.renameValue(list, "Doing", "In progress")).toEqual(["To do", "In progress", "Done"]);
	expect(Model.renameValue(list, "Doing", "Done")).toEqual(["To do", "Done"]);
	expect(Model.removeValue(list, "Doing")).toEqual(["To do", "Done"]);
	expect(Model.moveValue(list, "Done", -1)).toEqual(["To do", "Done", "Doing"]);
	expect(Model.moveValue(list, "To do", -1)).toEqual(list);
	expect(JSON.parse(Model.setProperty('{"columns":"a b","x":"1"}', "columns", "c"))).toEqual({columns: "c", x: "1"});
	expect(JSON.parse(Model.setProperty("not json", "lanes", "Jo"))).toEqual({lanes: "Jo"});
	expect(JSON.parse(Model.setProperty('{"lanes":"Jo"}', "lanes", ""))).toEqual({});
});

it("lays out the tiddlers of a wiki", function() {
	var wiki = new $tw.Wiki();
	wiki.addTiddlers([
		{title: "A", status: "Done", owner: "Jo"},
		{title: "B", status: "To do"},
		{title: "C", status: "To do", owner: "Jo"}]);
	var e = engine(wiki, {columns: "[[To do]] Done", laneField: "owner", lanes: "Jo"}, ["A", "B", "C", "Missing"]);
	e.order = ["C"];
	var layout = e.computeLayout();
	expect(layout.columns).toEqual([Model.NONE, "To do", "Done"]);
	expect(layout.lanes).toEqual([Model.NONE, "Jo"]);
	expect(layout.cells[Model.cellKey("To do", "Jo")]).toEqual(["C"]);
	expect(layout.cells[Model.cellKey("To do", Model.NONE)]).toEqual(["B"]);
	expect(layout.cells[Model.cellKey(Model.NONE, Model.NONE)]).toEqual(["Missing"]);
	expect(e.order).toEqual(["C", "A", "B", "Missing"]);
});

it("writes a moved card's fields to its tiddler", function() {
	var wiki = new $tw.Wiki();
	wiki.addTiddlers([
		{title: "A", status: "To do", owner: "Jo", text: "keep"},
		{title: "T", tags: ["Task", "To do"]}]);
	var e = engine(wiki, {columns: "[[To do]] Done", laneField: "owner", lanes: "Jo Kim"}, ["A"]);
	e.layout = e.computeLayout();
	e.assignCell("A", "Done", "Kim");
	expect(wiki.getTiddler("A").fields).toEqual(jasmine.objectContaining({status: "Done", owner: "Kim", text: "keep"}));
	e.assignCell("A", Model.NONE, Model.NONE);
	expect(wiki.getTiddler("A").fields.status).toBeUndefined();
	expect(wiki.getTiddler("A").fields.owner).toBeUndefined();
	// New tiddlers are created in their cell
	e.assignCell("New", "To do", "Jo");
	expect(wiki.getTiddler("New").fields).toEqual(jasmine.objectContaining({status: "To do", owner: "Jo"}));
	// Columns made of tags
	e = engine(wiki, {columnField: "tags", columns: "[[To do]] Done"}, ["T"]);
	e.layout = e.computeLayout();
	e.assignCell("T", "Done", Model.NONE);
	expect(wiki.getTiddler("T").fields.tags).toEqual(["Task", "Done"]);
});

it("renames a column on the board and on its cards", function() {
	var wiki = new $tw.Wiki();
	wiki.addTiddlers([
		{title: "Board", "graph.graph": '{"columns":"[[To do]] Done","laneField":"owner"}'},
		{title: "A", status: "To do", owner: "Jo"},
		{title: "B", status: "Done"}]);
	var e = engine(wiki, {store: "Board", columns: "[[To do]] Done", laneField: "owner"}, ["A", "B"]);
	e.layout = e.computeLayout();
	e.commitEditing({kind: "column", value: "To do"}, "Backlog");
	expect(wiki.getTiddler("A").fields.status).toBe("Backlog");
	expect(wiki.getTiddler("B").fields.status).toBe("Done");
	expect(JSON.parse(wiki.getTiddler("Board").fields["graph.graph"])).toEqual({columns: "Backlog Done", laneField: "owner"});
	e.layout = e.computeLayout();
	e.commitEditing({kind: "column", value: "\u0001new"}, "Review");
	expect(JSON.parse(wiki.getTiddler("Board").fields["graph.graph"]).columns).toBe("Backlog Done Review");
});

it("keeps the order in the store tiddler", function() {
	var wiki = new $tw.Wiki();
	var e = engine(wiki, {store: "Board"}, ["A", "B"]);
	e.order = ["B", "gone", "A"];
	e.saveOrder();
	expect(wiki.getTiddler("Board").fields.kanban).toBe("B A");
	e.loadOrder();
	expect(e.order).toEqual(["B", "A"]);
});

it("keeps the look of each column", function() {
	var styles = Model.parseStyles('{"Doing":{"label":"In progress","color":"#e92727","view":"compact","bad":1},"X":{"view":"huge"},"Y":5}');
	expect(styles.Doing).toEqual({label: "In progress", color: "#e92727", view: "compact"});
	expect(styles.X).toBeUndefined();
	expect(styles.Y).toBeUndefined();
	expect(Model.parseStyles("not json")).toEqual(Object.create(null));
	styles = Model.patchStyle(styles, "Doing", {color: "", fields: "", icon: "$:/core/images/done-button"});
	expect(styles.Doing).toEqual({label: "In progress", view: "compact", fields: "", icon: "$:/core/images/done-button"});
	styles = Model.renameStyle(styles, "Doing", "Busy");
	expect(styles.Doing).toBeUndefined();
	expect(styles.Busy.label).toBe("In progress");
	expect(Model.stringifyStyles(Model.patchStyle(styles, "Busy", {label: null, view: null, fields: null, icon: null}))).toBe("");
	var style = Model.columnStyle(styles, "Busy", 1);
	expect(style.color).toBe(Model.PALETTE[1]);
	expect(style.view).toBe("compact");
	expect(Model.columnStyle(styles, Model.NONE, 0).color).toBe("");
	expect(Model.columnStyle(styles, "Other", Model.PALETTE.length).view).toBe("full");
});

it("knows which project the board shows", function() {
	expect(Model.projectFilter("Project A")).toBe("[tag[Project A]]");
	expect(Model.activeProject(" [tag[Web]] ", ["App", "Web"])).toBe("Web");
	expect(Model.activeProject("[tag[Web]tag[App]]", ["App", "Web"])).toBe(null);
	expect(Model.activeProject("", ["App"])).toBe(null);
});

it("renames the look of a renamed column", function() {
	var wiki = new $tw.Wiki();
	wiki.addTiddlers([{title: "Board", "graph.graph": '{"columns":"Doing"}', "kanban-columns": '{"Doing":{"color":"#000000"}}'}]);
	var e = engine(wiki, {store: "Board", columns: "Doing"}, []);
	e.loadStyles();
	e.layout = e.computeLayout();
	e.commitEditing({kind: "column", value: "Doing"}, "Busy");
	expect(JSON.parse(wiki.getTiddler("Board").fields["kanban-columns"])).toEqual({Busy: {color: "#000000"}});
});

});
