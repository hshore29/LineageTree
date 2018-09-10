/*** Lineage Tree Drawing Class ***/
function LineageTree(container, logoURL) {
  let _ = this;
  _.box = {width: 130, height: 56, margin: 20};
  _.navHeight = 150;
  _.logoHeight = 3/4;
  _.logoOpacity = 0.25;
  _.k = 1;
  _.backgroundURL = logoURL || null;
  
  // Create main containers
  _.body = d3.select(container);
  _.svg = _.body.append("svg").attr("width", "100%").attr("height", "100%");
  _.view = _.svg.append("g").attr("class", "view-box");
  _.nav = _.body.append("div").attr("class", "nav container").append("svg");
  
  // Set up background containers
  if (_.backgroundURL) {
    _.bkgSource = _.body.append("div").style("display", "none")
        .append("svg").attr("id", "background");
    _.viewUse = _.view.append("use").attr("xlink:href", "#background")
        .attr("opacity", _.logoOpacity);
    _.navUse = _.nav.append("use").attr("xlink:href", "#background")
        .attr("opacity", _.logoOpacity);
  }

  // Add graph layers
  _.view.append("g").attr("class", "link-layer");
  _.view.append("g").attr("class", "node-layer");
  _.nav.append("g").attr("class", "link-layer");
  _.nav.append("g").attr("class", "node-layer");

  // Tree functions
  _.stratify = d3.stratify().id(d => d.name).parentId(d => d.parent);
  _.tree = d3.tree()
      .nodeSize([_.box.width + _.box.margin, _.box.height + _.box.margin])
      .separation((a, b) => {
        // If we share a parent, keep padding tight
        if (a.parent == b.parent) return 1;
        // Otherwise, add padding so we don't overlap either node's children
        let sep = 1;
        if (a.children) sep += (a.children.length - 1) / 2;
        if (b.children) sep += (b.children.length - 1) / 2;
        return sep;
      })

  // Define nav box scales
  _.navScaleY = d3.scaleLinear();
  _.navScaleX = d3.scaleLinear();
}

/*** Google Sheets Call Back ***/
LineageTree.prototype.parseGoogleSheet = function(data) {
  let rawdata = [];
  // Convert Google Sheets JSON to list of lists
  data.feed.entry.forEach(function(cell) {
    // If the cell is in col 1, start a new row
    if (cell["gs$cell"].col == "1") rawdata.push([]);
    // Fill in null cells
    while (+cell["gs$cell"].col - 1 > rawdata[rawdata.length - 1].length) {
      rawdata[rawdata.length - 1].push(null);
    }
    // Push cell value to end of row
    rawdata[rawdata.length - 1].push(cell["gs$cell"]["$t"]);
  });

  // Convert list of lists to list of objects, based on headers
  let cleandata = [];
  let header = rawdata.shift();
  rawdata.forEach(function(row, index) {
    cleanrow = row.reduce((map, r, i) => {
      map[header[i]] = r;
      return map;
    }, {id: index});
    cleanrow.year = +cleanrow.year;
    cleandata.push(cleanrow);
  });

  // Trigger data processing function
  this.buildTree(cleandata);
}

/*** Build Tree from hierarchical data ***/
LineageTree.prototype.buildTree = function(data) {
  let _ = this;
  // Add Dummy Root, and link parentless nodes to it
  data.forEach(function(d) {
    if (data.filter(f => f.name == d.parent).length == 0) d.parent = "N/A";
  })
  data.splice(0, 0, {name: "N/A", year: d3.min(data, d => d.year) - 1,
                     parent: null, dummy: true});

  // Stratify data and pull out nodes, links, actives
  _.root = _.stratify(data);
  _.nodeList = _.root.descendants();
  _.linkList = _.root.links();
  _.actives = _.nodeList.filter(n => n.data.active);

  // Save parent / child references before manipulating tree
  _.nodeList.forEach(n => {
    n.realParent = n.parent;
    n.realChildren = n.children ? n.children.slice(0) : null;
  });

  // Modify nodes before calculating node positions
  // Use a for loop since we want to run over nodes we add during the loop
  for (let i = 1; i < _.nodeList.length; i++) {
    let n = _.nodeList[i];
    // If this node is equal to its parent's year, move it up the tree
    while (n.data.year <= n.parent.data.year) {
      _.elevateNode(i);
    }
    // If this node is more than one year less than its parent's year,
    // add a spacer to move it down the tree
    if (n.data.year - n.parent.data.year > 1) {
      _.insertParent(i);
    }
  }

  // Tree function - Calculate node positions
  _.tree(_.root);

  // Remove dummy nodes
  _.nodeList = _.nodeList.filter(n => !n.data.dummy);
  _.nodeList.forEach(function(n) {
    n.parent = n.realParent;
    n.children = n.realChildren;
  })

  // Get dimensions of Tree
  _.xMin = d3.min(_.nodeList, d => d.x) - (_.box.width + _.box.margin) / 2;
  _.xMax = d3.max(_.nodeList, d => d.x) + (_.box.width + _.box.margin) / 2;
  _.yMin = d3.min(_.nodeList, d => d.y) - _.box.margin / 2;
  _.yMax = d3.max(_.nodeList, d => d.y) + _.box.height + _.box.margin / 2;

  // Set Navbox dimension / scales
  _.navWidth = _.navHeight * (_.xMax - _.xMin) / (_.yMax - _.yMin);
  _.navScaleY.domain([_.yMin, _.yMax]).range([0, _.navHeight]);
  _.navScaleX.domain([_.xMin, _.xMax]).range([0, _.navWidth]);

  // Trigger Graphing functions
  _.loadBackground();
  _.drawGraphAndNav();

  // Initialize additional features
  _.initSearch();
  _.initInfoBox();

}

/*** LineageTree Tree Manipulation Functions ***/
LineageTree.prototype.insertParent = function(i) {
  // Insert dummy nodes
  let c = this.nodeList[i];
  let a = c.parent;
  // Set Dummy Data
  let b = new d3.node({name: "", dummy: true, year: a.data.year + 1});
  // Link to Parent
  b.parent = a;
  a.children.splice(a.children.indexOf(c), 1, b);
  // Link to Child
  b.children = [c];
  c.parent = b;
  // Update depth
  b.depth = a.depth + 1;
  c.descendants().forEach(n => n.depth += 1);
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
  n.descendants().forEach(d => d.depth--);
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
    let spacer = {name: "", dummy: true, year: p.parent.data.year + 1};
    spacer = new d3.node(spacer);
    spacer.parent = p.parent;
    spacer.depth = p.depth;
    p.parent.children.splice(0, 0, spacer);
    this.nodeList.splice(i, 0, spacer);
  }
}

/*** LineageTree Graphing functions ***/
LineageTree.prototype.drawGraphAndNav = function() {
  let _ = this;
  // Draw links
  _.view.select(".link-layer").selectAll(".link").data(_.linkList).enter()
      .append("path")
          .attr("class", d => "link t-" + d.target.data.id)
          .attr("d", _.linkPathGen());
  // Add nodes
  _.node = _.view.select(".node-layer")
      .selectAll(".node").data(_.nodeList).enter()
      .append("g")
          .attr("id", d => "b-" + d.data.id)
          .attr("class", d => "node" + (d.data.active ? " node-undergrad" : ""))
          .attr("transform", d => "translate(" + d.x + "," + d.y + ")");
  // Add node contents
  _.node.append("rect")
      .attr("class", "node-box")
      .attr("x", -_.box.width / 2)
      .attr("width", _.box.width)
      .attr("height", _.box.height)
      .on("click", _.activateNode);
  _.node.append("text")
      .attr("dy", 16)
      .style("text-anchor", "middle")
      .text(d => d.data.name)
      .on("click", _.activateNode);
  _.node.append("text")
      .attr("dy", 32)
      .style("text-anchor", "middle")
      .text(d => d.data.year_label)
      .on("click", _.activateNode);
  _.node.append("text")
      .attr("dy", 48)
      .style("text-anchor", "middle")
      .text(d => d.data.pledge_label)
      .on("click", _.activateNode);

  // Set nav box size
  _.nav.attr("height", _.navHeight).attr("width", _.navWidth);

  // Draw nav links
  _.nav.select(".link-layer").selectAll(".link").data(_.linkList).enter()
      .append("path")
          .attr("class", d => "link link-nav t-" + d.target.data.id)
          .attr("d", _.linkPathGen(_.navScaleX, _.navScaleY));
  // Add dots for undergrad nodes
  _.nav.select(".node-layer").selectAll(".dot").data(_.actives).enter()
      .append("circle")
          .attr("class", d => "dot a-" + d.data.id)
          .attr("cx", d => _.navScaleX(d.x))
          .attr("cy", d => _.navScaleY(d.y))
          .attr("r", 1.5);

  // Initialize Brush
  _.brush = _.nav.append("rect").attr("class", "brush");
  _.updateBrush({x: 0, y: 0});

  // Initialize Pan & Zoom behavior
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
    x = Math.max(0, Math.min(x, _.navWidth - b.attr("width")));
    y = Math.max(0, Math.min(y, _.navHeight - b.attr("height")));
    _.svg.call(_.zoom.translateTo,
               _.navScaleX.invert(x + b.attr("width") / 2),
               _.navScaleY.invert(y + b.attr("height") / 2)
               );
    b.attr("x", x).attr("y", y);
  }
  _.brush.call(_.drag);

  // Add Resize Listener
  window.addEventListener("resize", () => _.updateBrush());

  // Move to Center
  _.svg.call(_.zoom.translateTo, 0, 0);
}

LineageTree.prototype.loadBackground = function() {
  let _ = this;
  if (_.backgroundURL) {
    // Load Background
    d3.xml(_.backgroundURL).then(function(svg) {
      let svgTag = svg.getElementsByTagName("svg")[0];
      _.bkgSource.node().appendChild(svgTag);
      let bkgX = +svgTag.getAttribute("width");
      let bkgY = +svgTag.getAttribute("height");
      let viewScale = _.yMax / bkgY * _.logoHeight;
      let dx = -bkgX / 2;
      let dy = _.box.height + _.box.margin * 2;
      _.viewUse.attr("transform", "translate(" + dx * viewScale + "," +
                     dy + ") scale(" + viewScale  + ")");
      let navScale = _.navHeight / bkgY * _.logoHeight;
      _.navUse.attr("width", bkgX).attr("height", bkgY)
        .attr("transform", "translate(" + (_.navScaleX(0) + dx * navScale) +
              "," + _.navScaleY(dy) * 2 + ") scale(" + navScale + ")");
    });
  }
}

/*** LineageTree Graph Listener Functions ***/
LineageTree.prototype.updateBrush = function(e) {
  let _ = this;
  let svg = $(_.svg.node());
  _.brush
      .attr("width", (_.navScaleX(svg.width()) - _.navScaleX(0)) / _.k)
      .attr("height", (_.navScaleY(svg.height()) - _.navScaleY(0)) / _.k);
  if (e) _.brush.attr("x", _.navScaleX(-e.x / _.k));
  if (e) _.brush.attr("y", _.navScaleY(-e.y / _.k));
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
      path.push([
        link.source.x,
        link.source.y + _.box.height + (_.box.margin / 2)
      ]);
    }
    if (link.source.y >= link.target.y) {
      path.push([
        (link.target.x + link.source.x) / 2,
        link.target.y - (_.box.margin / 2)
      ]);
      //path.push([link.source.x, link.source.y + (_.box.height / 2)]);
      //path.push([link.target.x, link.target.y + (_.box.height / 2)]);
    }
    path.push([link.target.x, link.target.y]);
    return line(path);
  };
  return linkPath;
}

LineageTree.prototype.activateNode = function(node, i, fromSearch) {
  // Reset Node & Link Classes
  $(".node-active").removeClass("node-active");
  $(".node-ancestor").removeClass("node-ancestor");
  $(".node-descendant").removeClass("node-descendant");
  $(".link-ancestor").removeClass("link-ancestor");
  $(".link-descendant").removeClass("link-descendant");
  $(".dot-descendant").removeClass("dot-descendant");

  // Add Node & Link Classes
  $("#b-" + node.data.id).addClass("node-active");
  $(".t-" + node.data.id).addClass("link-ancestor");
  node.ancestors().slice(1).forEach(a => {
    $("#b-" + a.data.id).addClass("node-ancestor");
    $(".t-" + a.data.id).addClass("link-ancestor").each(function() {
      $(this).parent().append(this);
    });
  });
  node.descendants().slice(1).forEach(d => {
    $("#b-" + d.data.id).addClass("node-descendant");
    $(".t-" + d.data.id).addClass("link-descendant").each(function() {
      $(this).parent().append(this);
    });
    $(".a-" + d.data.id).addClass("dot-descendant");
  });

  // Populate Infobox - basic details
  $(".td-name").text(node.data.name);
  $(".td-year").text(node.data.year_label);
  $(".td-big").text(node.parent.data.name).data("id", node.parent.data.id);
  if (node.data.pledge_label) {
    $(".td-pledge").text(node.data.pledge_label);
    $(".td-pledge").parent().show();
  } else {
    $(".td-pledge").parent().hide();
  }
  if (node.children) {
    let ul = $(".td-littles ul").empty();
    node.children.forEach(c => {
      $("<li/>").text(c.data.name).data("id", c.data.id)
          .addClass("info-link").appendTo(ul);
    });
    ul.closest("tr").show();
    $(".td-nolittles").parent().hide();
  } else {
    $(".td-littles").parent().hide();
    $(".td-nolittles").parent().show();
  }
  // Populate Infobox - descendant details
  let desc = node.descendants().slice(1);
  if (desc.length > 0) {
    $(".td-desc-count").text(desc.length);
    let actives = desc.filter(d => d.data.active);
    if (actives.length > 0) {
      $(".td-act-count span").text(actives.length);
      $(".td-act-count").parent().show();
      $(".td-noactives").parent().hide();
    } else {
      $(".td-act-count").parent().hide();
      $(".td-noactives").parent().show();
    }
    $(".descendants").show();
  } else {
    $(".descendants").hide();
  }
  $(".info").show();
}

/*** LineageTree Search Box Functions ***/
LineageTree.prototype.initSearch = function() {
  var _ = this;

  // Add Event Listeners
  $("#search-box").on("keyup", () => _.search());
  $("#search-box").on("focus", () => _.search());
  $("#search-box").parent().on("focusout", function(e) {
    if (e.relatedTarget != this) $(".results-box").hide();
  });

  $(".results-box").on("click", ".result", function() {
    $(".result-selected").removeClass("result-selected");
    $(this).addClass("result-selected");
    let name = $(this).data("id");
    let node = _.nodeList.filter(n => n.id == name);
    if (node.length == 1) {
      _.svg.call(_.zoom.translateTo, node[0].x, node[0].y);
      _.activateNode(node[0]);
    }
  });

  // Enable search
  $("#search-box").prop("disabled", false);
}

LineageTree.prototype.search = function() {
  let _ = this;
  let q = $("#search-box").val().toLowerCase();
  let resultsBox = $(".results-box");
  if (q.length < 3) {
    resultsBox.hide();
    return;
  }
  let results = _.nodeList.filter(n => n.data.dummy !== true)
      .filter(n => n.id.toLowerCase().includes(q))
      .sort((a, b) => a.data.year - b.data.year);
  if (results.length < 1) {
    resultsBox.hide();
    return;
  }
  resultsBox.empty();
  results.forEach(function(r) {
    $("<div>").addClass("result").data("id", r.id)
        .text(r.id + " '" + r.data.year.toString().substr(2))
        .appendTo(resultsBox);
  });
  resultsBox.show();
}

/*** LineageTree Info Box Functions ***/
LineageTree.prototype.initInfoBox = function() {
  let _ = this;
  // Set active count default text
  $(".td-act-count").html("<span></span> / " + _.actives.length);
  // Add Info-Link listener
  $(".info").on("click", ".info-link", function() {
    let node = _.nodeList.filter(n => n.data.id == $(this).data("id"));
    if (node.length == 1) {
      _.svg.transition().call(_.zoom.translateTo, node[0].x, node[0].y);
      _.activateNode(node[0]);
    }
  });
}