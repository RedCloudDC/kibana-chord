// This module defines the Angular controller that renders the Chord Diagram.
define(function(require) {

  // Load D3 v4 via our custom bundle build output.
  var d3 = require("../d3/d3.min");

  // Load the module that defines the Chord Diagram using D3.
  var ChordDiagram = require("./chordDiagram");

  // Load the module that defines the HTML Table using D3.
  var Table = require("./table");

  // Access the Kibana plugin Angular module.
  var module = require("ui/modules").get("kibana-chord");


  // Create a time formatter for the timestamp in the table.
  var formatTime = d3.timeFormat("%b %d, %y %X");


  // Register the controller with the Kibana plugin Angular module.
  module.controller("ChordController", function($scope, $rootScope, Private, $element, $http) {

    // Inject the tabify utility from Kibana internals.
    var tabifyAggResponse = Private(require("ui/agg_response/tabify/tabify"));

    // Access the DOM element provided by Angular's dependency injection.
    var div = $element[0];

    // Construct a Bootstrap Grid to position the Chord Diagram and Table.
    var container = d3.select(div).style("width", "100%")
          .append("div").attr("class", "container-fluid")
          .append("div").attr("class", "row"),
        chordContainer = container.append("div")
          .attr("class", "col-md-6"),
        rightPanel = container.append("div")
          .attr("class", "col-md-6"),
        tableContainer = rightPanel.append("div"),
        moreButton = rightPanel.append("div")
            .style("text-align", "center")
          .append("button")
            .text("More")
            .style("display", "none");

    // Construct an instance of the Chord Diagram.
    var chordDiagram = ChordDiagram(chordContainer.node());

    // Construct an instance of the HTML Table.
    var table = Table(tableContainer.node());

    // Converts hierarchical result set from ElasticSearch into a tabular form.
    // Returns an array of row objects, similar to the format returned by d3.csv.
    function tabify(response){

      var tabified = tabifyAggResponse($scope.vis, response, {
        asAggConfigResults: true
      });

      // Handle the case of a filter being applied in "Split Chart",
      // which yields a nested data structure with the table one level deeper.
      if("tables" in tabified.tables[0]){
        tabified = tabified.tables[0];
      }

      return tabified.tables[0].rows.map(function (array){
        var row = {};
        array.forEach(function (entry){
          row[entry.aggConfig.id] = entry.value;
        });
        return row;
      });
    }

    // Update the visualization with new data as the query response changes.
    $scope.$watch("esResponse", function(response) {

      // Guard against undefined value, which always occurs
      // after the plugin is loaded and before the data gets loaded.
      if(response){

        // Tabify the response.
        var data = tabify(response);

        // Pass the fresh data into the Chord Diagram.
        chordDiagram.data(data);

        // Render the Chord Diagram.
        chordDiagram();

        // Update the table (if a ribbon is currently selected).
        // This is invoked here to handle the case of auto-refresh.
        if(chordDiagram.selectedRibbon()){
          updateTable();
        }
      }
    });

    // Updates the details table based on the selected chord.
    function updateTable(){
    
      // Get the currently selected ribbon.
      var selectedRibbon = chordDiagram.selectedRibbon();

      if(selectedRibbon){

        var tableTitle = (
          "Flows between " + selectedRibbon.source +
          " and " + selectedRibbon.destination
        );

        // Extract the time interval from the global timeFilter.
        var timeBounds = $rootScope.timefilter.getBounds();

        // Construct the HTTP POST payload for the query middleware.
        var options = {
          source: selectedRibbon.source,
          destination: selectedRibbon.destination,
          index: $scope.vis.indexPattern.id,
          time: {
            gte: timeBounds.min.toDate().getTime(),
            lte: timeBounds.max.toDate().getTime(),
            format: "epoch_millis"
          }
        };

        // Invoke the query middleware, then render it into the table.
        $http
          .post("/api/kibana-chord", options)
          .then(function successCallback(response){
            var data = parseResponseHits(response);

            // Render the HTML Table.
            var columns = [
              { title: "Source IP", property: "sourceip" },
              { title: "Dest IP", property: "destinationip" },
              { title: "Source PG", property: "source" },
              { title: "Dest PG", property: "dest" },
              { title: "Type", property: "type" },
              { title: "Timestamp", property: "timestamp" },
              { title: "Packets", property: "packets" }
            ];

            table
              .data(data)
              .columns(columns)
              .title(tableTitle)
              ();

            moreButton.style("display", "inline-block");

            moreButton.on("click", function (){
              var options = {
                scrollId: response.data._scroll_id,
                scroll: "30s"
              };

              // Invoke the scroll middleware, then append it into the table.
              $http
                .post("/api/kibana-chord-scroll", options)
                .then(function successCallback(scrollResponse){
                  var newData = parseResponseHits(scrollResponse);
                  var oldData = table.data();
                  var data = oldData.concat(newData);
                  table.data(data);
                  table();

                  // Record the new scroll ID for next time around.
                  response.data._scroll_id = scrollResponse.data._scroll_id;
                });
            });

          }, function errorCallback(response){
            throw response;
          });


      // If there is no selected ribbon, then
      } else {

        // clear the existing table.
        table
          .data([])
          .columns([])
          .title("")
          ();
        moreButton.style("display", "none");

      }
    }

    // Invoke our custom middleware for querying ElasticSearch
    // when the user clicks on the ribbon.
    chordDiagram.onSelectedRibbonChange(updateTable);
  });

  function parseResponseHits(response){

    // Transform the response data into a form the table can use.
    return response.data.hits.hits.map(function (d){
      d = d._source;

      // Format timestamp as human-readable date.
      d.timestamp = formatTime(new Date(d.timestamp));

      // Add source and dest attribute to be used in table
      d.source = d.nuage_metadata.sourcepolicygroups;
      d.dest = d.nuage_metadata.destinationpolicygroups;

      return d;
    });
  }
});
