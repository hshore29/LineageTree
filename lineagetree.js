/*** Google Sheets Call Back ***/
function drawGraph(data) {
  let rawdata = [];
  // Convert Google Sheets JSON to list of lists
  data.feed.entry.forEach(function(cell) {
    // If the cell is in col 1, start a new row
    if (cell["gs$cell"].col == "1") rawdata.push([]);
    // Fill in null cells
    while (+cell["gs$cell"].col - 1 > rawdata[rawdata.length - 1].length) {
      rawdata[rawdata.length - 1].push(null);
    }
    // Push cell value to 
    rawdata[rawdata.length - 1].push(cell["gs$cell"]["$t"]);
  });

  // Convert list of lists to list of objects, based on headers
  let cleandata = [];
  let header = rawdata.shift();
  rawdata.forEach(function(row, index) {
    let mapped = {id: index};
    for (let i=0; i < row.length; i++) {
      mapped[header[i]] = row[i];
    }
    cleandata.push(mapped);
  });

  // Run any necessary data conversion
  cleandata.forEach(function(row) {
    row.year = +row.year;
  });
  
  // Create 
  tree = new LineageTree(cleandata);
}

/*** Lineage Tree Drawing Class ***/
function LineageTree(data) {
  let _ = this;
  _.box = {width: 120, height: 56, margin: 20};
  _.navBox = {width: 150, height: 150};
  _.width = $("svg").width();
  _.height = $("svg").height();
  _.svg = d3.select("#tree-box");
  _.view = _.svg.append("g").attr("class", "view-box");
  _.nav = d3.select("#nav-box");
  
  // Tree function
  _.tree = d3.tree().nodeSize([
    _.box.width + _.box.margin,
    _.box.height + _.box.margin
  ]).separation((a, b) => {
    // If we share a parent, keep padding tight
    if (a.parent == b.parent) return 1;
    // Otherwise, add padding so we don't overlap either node's children
    let sep = 1;
    if (a.children) sep += (a.children.length - 1) / 2;
    if (b.children) sep += (b.children.length - 1) / 2;
    return sep;
  });
  
  // Stratify Data
  for (let i=0; i < data.length; i++) {
    if (data.filter(d => d.name == data[i].parent).length == 0) data[i].parent = "N/A";
  }
  data.splice(0, 0, {name: "N/A", year: d3.min(data, d => d.year) - 1, parent: null, dummy: true});
  _.root = d3.stratify().id(d => d.name).parentId(d => d.parent)(data);
  _.nodeList = _.root.descendants();
  _.linkList = _.root.links();

  // Modify nodes before calculating node positions
  for (let i=1; i < _.nodeList.length; i++) {
    let n = _.nodeList[i];
    // If this node is equal to its parent's year, move it up the tree
    while (n.data.year <= n.parent.data.year) {
      _.elevateNode(i);
    }
    // Insert spacers if more than one year between this and parent
    if (n.data.year - n.parent.data.year > 1) {
      _.insertParent(i);
    }
  }

  // Calculate node positions
  _.tree(_.root);
  
  // Get dimensions of Tree 
  let leaves = _.root.leaves();
  _.xMin = d3.min(leaves, d => d.x) - (_.box.width + _.box.margin) / 2;
  _.xMax = d3.max(leaves, d => d.x) + (_.box.width + _.box.margin) / 2;
  _.yMin = 0 - _.box.margin / 2;
  _.yMax = d3.max(leaves, d => d.y) + _.box.height + _.box.margin / 2;
  
  // Draw lineage tree
  // Draw links
  _.link = _.view.selectAll(".link")
      .data(_.linkList).enter()
      .append("path")
          .attr("class", "link")
          .attr("d", _.linkPathGen());
  // Add nodes
  _.node = _.view.selectAll(".node")
      .data(_.nodeList).enter()
      .append("g")
          .attr("id", d => "b-" + d.data.id)
          .attr("class", d => d.data.dummy ? "node-hidden" : "node")
          .attr("transform", d => "translate(" + d.x + "," + d.y + ")");
  // Add node content
  _.node.append("rect")
      .attr("class", "node-box")
      .attr("x", -_.box.width / 2)
      .attr("width", _.box.width)
      .attr("height", _.box.height)
      .on("click", d => _.activateNode(d.data.id));
  _.node.append("text")
      .attr("dy", 16)
      .style("text-anchor", "middle")
      .text(d => d.data.name)
      .on("click", d => _.activateNode(d.data.id));
  _.node.append("text")
      .attr("dy", 32)
      .style("text-anchor", "middle")
      .text(d => d.data.year_label)
      .on("click", d => _.activateNode(d.data.id));
  _.node.append("text")
      .attr("dy", 48)
      .style("text-anchor", "middle")
      .text(d => d.data.pledge_label)
      .on("click", d => _.activateNode(d.data.id));
  
  // Define nav box scales
  _.navBox.width = _.navBox.height * (_.xMax - _.xMin) / (_.yMax - _.yMin);
  _.navScaleY = d3.scaleLinear().domain([_.yMin, _.yMax]).range([0, _.navBox.height]);
  _.navScaleX = d3.scaleLinear().domain([_.xMin, _.xMax]).range([0, _.navBox.width]);
  
  // Set nav box size, draw links & initialize brush
  _.nav.attr("height", _.navBox.height).attr("width", _.navBox.width);
  _.nav.append("g").attr("class", "links").selectAll(".link")
      .data(_.linkList)
      .enter().append("path")
          .attr("class", "link")
          .attr("d", _.linkPathGen(_.navScaleX, _.navScaleY));
  _.brush = _.nav.append("rect").attr("class", "brush");
  _.updateBrush({x: 0, y: 0, k: 1});

  // Initialize Pan & Zoom behavior
  _.k = 1;
  _.zoom = d3.zoom()
      .scaleExtent([0.5, 1])
      .translateExtent([[_.xMin, _.yMin], [_.xMax, _.yMax]])
      .on("zoom", zoomed);
  function zoomed() {
    _.k = d3.event.transform.k;
    _.view.attr("transform", d3.event.transform);
    _.updateBrush(d3.event.transform);
  }
  _.svg.call(_.zoom);

  // Initialize Drag behavior
  _.dragOffset = {x: 0, y: 0};
  _.drag = d3.drag()
      .on("start", dragStart)
      .on("drag", dragged);
  function dragStart() {
    _.dragOffset.x = d3.event.x - d3.select(this).attr("x");
    _.dragOffset.y = d3.event.y - d3.select(this).attr("y");
  }
  function dragged() {
    let x = d3.event.x - _.dragOffset.x;
    let y = d3.event.y - _.dragOffset.y;
    let b = d3.select(this);
    x = Math.max(0, Math.min(x, _.navBox.width - b.attr("width")));
    y = Math.max(0, Math.min(y, _.navBox.height - b.attr("height")));
    _.svg.call(_.zoom.translateTo,
               _.navScaleX.invert(x + b.attr("width") / 2),
               _.navScaleY.invert(y + b.attr("height") / 2)
               );
    b.attr("x", x).attr("y", y);
  }
  _.brush.call(_.drag);
  
  // Initialize search box
  _.initSearch();
}

/*** LineageTree Tree Manipulation Functions ***/
LineageTree.prototype.insertParent = function(i) {
  // Insert dummy nodes
  let c = this.nodeList[i];
  let a = c.parent;
  // Set Dummy Data
  let b = new d3.node({name: c.id, dummy: true, year: a.data.year + 1});
  // Link to Parent
  b.parent = a;
  a.children.splice(a.children.indexOf(c), 1, b);
  // Link to Child
  b.children = [c];
  c.parent = b;
  // Update depth
  b.depth = a.depth + 1;
  c.descendants().map(n => n.depth += 1);
  // Height doesn't seem to be used, so we won't update it
  this.nodeList.splice(i, 0, b);
}

LineageTree.prototype.elevateNode = function(i) {
  let n = this.nodeList[i];
  let p = n.parent;
  // Remove n as child of p
  p.children.splice(p.children.indexOf(n), 1);
  if (p.children.length == 0) p.children = null;
  // Add n as child of p's parent
  let ci = p.parent.children.indexOf(p);
  let cl = p.parent.children.length;
  let ni = ci == 0 && cl > 1 ? 0 : cl;
  p.parent.children.splice(ni, 0, n);
  // Update depth
  n.descendants().map(d => d.depth--);
  // Height doesn't seem to be used, so we won't update it
  // Set n's parent to p's parent
  n.parent = p.parent;
  // If p was an only child, add a spacer to keep p centered
  let grandparent = p.parent;
  while (true) {
    if (grandparent.dummy === undefined) break;
    grandparent = grandparent.parent;
  }
  if (n.data.year == p.data.year && grandparent.children.length % 2 == 0) {
    let spacer = new d3.node({name: n.id, dummy: true, year: p.parent.data.year + 1});
    spacer.parent = p.parent;
    spacer.depth = p.depth;
    p.parent.children.splice(0, 0, spacer);
    this.nodeList.splice(i, 0, spacer);
  }
}

/*** LineageTree Graph Listener Functions ***/
LineageTree.prototype.updateBrush = function(e) {
  this.brush
      .attr("x", this.navScaleX(-e.x / e.k))
      .attr("y", this.navScaleY(-e.y / e.k))
      .attr("width", (this.navScaleX(this.width) - this.navScaleX(0)) / e.k)
      .attr("height", (this.navScaleY(this.height) - this.navScaleY(0)) / e.k);
}

LineageTree.prototype.linkPathGen = function (x, y) {
  let _ = this;
  // Define line function with x and y scales
  let line = d3.line().curve(d3.curveStepAfter);
  if (x) line.x(d => x(d[0]));
  if (y) line.y(d => y(d[1]));
  // Create and return link function
  let linkPath = function (link) {
    let path = [];
    path.push([link.source.x, link.source.y]);
    if (link.source.x != link.target.x) {
    //if (link.source.x != link.target.x && link.source.y < link.target.y) {
      path.push([link.source.x, link.source.y + _.box.height + (_.box.margin / 2)]);
    }
    if (link.source.y >= link.target.y) {
      path.push([(link.target.x + link.source.x) / 2, link.target.y - (_.box.margin / 2)]);
      //path.push([link.source.x, link.source.y + (_.box.height / 2)]);
      //path.push([link.target.x, link.target.y + (_.box.height / 2)]);
    }
    path.push([link.target.x, link.target.y]);
    return line(path);
  };
  return linkPath;
}

LineageTree.prototype.activateNode = function(id) {
  $(".node rect.active").removeClass("active");
  $("#b-" + id + " rect").addClass("active");
}

/*** LineageTree Search Box Initialization ***/
LineageTree.prototype.initSearch = function() {
  var _ = this;
  
  // Add Event Listeners
  $("#search-box").on("keyup", function() {
    let q = this.value.toLowerCase();
    if (q.length < 3) {
      $("#results-box").hide();
      return;
    }
    let results = _.nodeList.filter(n => n.data.dummy !== true)
        .filter(n => n.id.toLowerCase().includes(q))
        .sort((a, b) => a.data.year - b.data.year);
    if (results.length < 1) {
      $("#results-box").hide();
      return;
    }
    d3.selectAll(".result").remove();
    d3.select("#results-box")
        .selectAll(".result")
        .data(results).enter()
            .append("div")
            .attr("class", "result")
            .attr("data-id", r => r.id)
            .text(r => r.id + " '" + r.data.year.toString().substr(2));
    $("#results-box").show();
  });
  
  $("#results-box").on("click", ".result", function() {
    $(".result.active").removeClass("active");
    $(this).addClass("active");
    let name = $(this).data("id");
    let node = _.nodeList.filter(n => n.id == name);
    if (node.length == 1) {
      _.activateNode(node[0].data.id);
      _.svg.call(_.zoom.translateTo, node[0].x, node[0].y);
    }
  });
    
  // Enable search
  $("#search-box").prop("disabled", false);
}