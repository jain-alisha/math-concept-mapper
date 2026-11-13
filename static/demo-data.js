/* Fictional, deterministic presentation fixtures. No real accounts or student data. */
(function () {
  const unit = 'Ratios & Proportional Relationships';
  const projects = [
    {id:'ratios',name:'Recipe Ratios',grade:'6th Grade Math',unit,labels:["Ratio","Ratio notation","Equivalent ratios","Ratio table","Tape diagram","Part-to-whole ratio"],edges:[
      [0,1,'Two cups of oats for three cups of milk is 2:3. The order tells us which quantity comes first.'],
      [1,2,'Scaling 2:3 by 2 gives 4:6. Both quantities must change by the same factor.'],
      [2,3,'Each table row scales both ingredients equally: (2,3), (4,6), and (6,9).'],
      [2,4,'Two equal bars for oats and three for milk show the same relationship as 2:3.'],
      [3,5,'The table gives 12 cups of oats and 18 of milk. Oats are 12 out of 30 cups altogether: the part-to-whole ratio is 2:5.'],
      [4,5,'The tape diagram has 2 oats parts and 3 milk parts: oats make up 2 of the 5 parts of the whole mixture.'],
      [1,5,'A ratio compares quantities; 2:3 is not the fraction of oats in the whole mixture. That fraction is 2/5.'] ]},
    {id:'rates',name:'Everyday Unit Rates',grade:'6th Grade Math',unit,labels:["Unit rate","Equivalent rates","Quotient","Speed","Distance","Scale"],edges:[
      [0,1,'$7.50 for 3 notebooks is $2.50 for one notebook: divide cost by the number of notebooks.'],
      [0,2,'A runner covers 3/4 mile in 1/2 hour. (3/4) ÷ (1/2) = 1.5 miles per hour.'],
      [1,3,'120 miles in 2 hours is 60 miles per hour, just like finding a price for one item.'],
      [2,3,'The units still matter when the distance or time is a fraction.'],
      [3,4,'At a steady 60 miles per hour, 3.5 hours gives 210 miles.'],
      [0,5,'A scale of 1 cm to 4 m tells us the real distance for one centimeter on the diagram.'],
      [5,4,'A 7 cm path represents 28 m when every centimeter represents 4 m.'] ]},
    {id:'percents',name:'The Percent Shop',grade:'6th Grade Math',unit,labels:["Percent","Part and whole","Percent equation","Percent increase","Percent decrease","Discount"],edges:[
      [0,1,'25% means 25 out of 100, or one quarter. So 25% of 80 is 20.'],
      [1,2,'I identify the whole before multiplying: 15% of 60 students is 9 students.'],
      [1,3,'A 10% increase on $40 adds $4, so the new price is $44.'],
      [1,4,'A 10% decrease on $40 subtracts $4, so the new price is $36.'],
      [4,5,'A 20% discount on $50 removes $10. The sale price is $40.'],
      [0,5,'After a 20% discount, I pay 80% of the original price.'],
      [3,4,'Increasing $40 by 10% and then decreasing $44 by 10% gives $39.60. The whole changed.'] ]},
    {id:'fractions',name:'Fractions Tell a Story',grade:'3rd Grade Math',unit:'Number & Operations—Fractions',labels:["Equal parts","Unit fraction","Fraction","Number line","Equivalent fractions","Fraction comparison"],edges:[
      [0,1,'When one whole is cut into 5 equal parts, each part is 1/5 of that whole.'],
      [1,2,'3/5 is three copies of 1/5. The pieces must come from the same-sized whole.'],
      [2,3,'Three steps of length 1/5 from 0 locate 3/5 on the number line.'],
      [4,3,'2/3 and 4/6 land at the same point because they name the same amount.'],
      [0,4,'Splitting each third in half changes 2 shaded thirds into 4 shaded sixths without changing the shaded amount.'],
      [1,5,'With the same whole and denominator, each piece has the same size. Five eighths is more than three eighths.'],
      [3,5,'On one number line, 5/8 is to the right of 3/8, so 5/8 is greater.'] ]},
    {id:'geometry',name:'Shapes, Parts & Area',grade:'3rd Grade Math',unit:'Geometry',labels:["Shape","Quadrilateral","Shape properties","Equal areas","Area fraction"],edges:[
      [0,1,'Squares and rectangles both have four sides and four right angles; a square is a special rectangle.'],
      [1,2,'To draw a rectangle, I need four right angles. Equal side lengths are an extra condition for a square.'],
      [2,3,'I drew a rectangle and split it into four equal-area parts. The parts can have different shapes.'],
      [3,4,'Each of four equal-area parts covers 1/4 of the original shape.'],
      [0,2,'A drawing must satisfy the stated attributes; its direction on the page does not change its category.'],
      [2,4,'Two of the four equal-area parts cover 2/4, or 1/2, of my rectangle.'] ]},
    {id:'proportions',name:'From Tables to Equations',grade:'7th Grade Math',unit,labels:["Ratio table","Proportional graph","Proportional relationship","Constant of proportionality","Slope","Proportional equation"],edges:[
      [0,3,'For (2,6), (3,9), and (5,15), y/x is always 3. The constant is 3, not the difference between columns.'],
      [3,5,'Since y is always three times x, the equation is y = 3x.'],
      [5,2,'The equation y = 3x has the form y = kx. There is no added starting amount.'],
      [2,1,'Plotting y = 3x gives a straight line through (0,0).'],
      [1,4,'The graph includes (1,3), so its constant of proportionality is 3.'],
      [4,3,'The graph and table show the same three units of y for every one unit of x.'],
      [0,1,'A table with a constant quotient gives points on a line through the origin.'] ]},
  ];
  const names=['Maya Patel','Jordan Kim','Priya Shah','Sam Torres','Chen Liu','Amara Brooks','Leo Rivera','Zoe Bennett','Eli Morgan','Nora Hassan','Arjun Mehta','Sofia Reyes'];
  const roster=names.map((name,i)=>({student_id:'demo-student-'+i,student_display_name:name,student_email:null}));
  const classes=[{id:'sample-class',name:'Math Studio · Ratios & Rates',projectIds:['ratios','rates','percents']},{id:'sample-lab',name:'Math Lab · Connections',projectIds:['fractions','geometry','proportions']}];
  // Authored, loose arrangements: each project has its own silhouette. Stable
  // positions across growth frames make changes in reasoning easy to follow.
  const arrangements = {
    ratios: [[75,50],[520,105],[160,235],[650,310],[25,420],[490,530]],
    rates: [[320,235],[25,50],[620,90],[590,350],[260,545],[30,410]],
    percents: [[30,55],[360,245],[35,450],[690,65],[680,440],[460,600]],
    fractions: [[45,65],[520,115],[170,265],[650,335],[20,450],[500,560]],
    geometry: [[320,45],[680,200],[300,310],[30,470],[640,550]],
    proportions: [[25,80],[650,370],[530,560],[500,90],[40,520],[190,270]],
  };
  function dataFor(project, count, edgeCount, variant=0) {
    const nodes=project.labels.slice(0,count).map((l,i)=>{
      const [x,y]=arrangements[project.id][i];
      return {i:i+1,l,x:Math.round(x*0.75)+(variant ? ((variant+i)%3-1)*10 : 0),y:Math.round(y*0.85)+(variant ? ((variant*2+i)%3-1)*8 : 0),m:{grade:project.grade,unit:project.unit,presentationColor:i%6,...(window.SpanConceptBank?.resolve(l) ? {conceptId:window.SpanConceptBank.resolve(l).id} : {})}};
    });
    const edges=project.edges.filter(([s,t])=>s<count&&t<count).slice(0,edgeCount).map(([s,t,note],i)=>({i:i+1,s:s+1,t:t+1,no:variant&&i%4===3?'':note,rt:'related'}));
    return {n:nodes,e:edges};
  }
  const activities=classes.flatMap(cls=>cls.projectIds.map((id,i)=>{const p=projects.find(p=>p.id===id);return {id:'demo-activity-'+id,class_id:cls.id,name:p.name,concepts:p.labels.map(l=>p.grade+'::'+p.unit+'::'+l),created_at:`2026-11-${String(i+2).padStart(2,'0')}T15:00:00Z`,ai_disabled:true,preview_data:dataFor(p,p.labels.length,2)};}));
  const maps=activities.flatMap((a,aIndex)=>roster.flatMap((student,index)=>{
    // One genuine non-submission state per assignment, with no fabricated empty map.
    if(index===11 && aIndex%3===2)return [];
    const p=projects.find(p=>'demo-activity-'+p.id===a.id);
    const edgeCount=[7,5,4,3,6,7,5,4,6,2,5,3][index];
    return [{id:'demo-map-'+a.id+'-'+index,owner_id:student.student_id,activity_id:a.id,title:p.name+' · '+student.student_display_name.split(' ')[0],created_at:`2026-11-${String(5+aIndex).padStart(2,'0')}T15:00:00Z`,updated_at:`2026-11-${String(7+aIndex).padStart(2,'0')}T16:${String(index*4).padStart(2,'0')}:00Z`,data:dataFor(p,p.labels.length,edgeCount,index)}];
  }));
  const timelines=projects.filter(p=>['ratios','fractions','proportions'].includes(p.id)).map(p=>({id:'demo-timeline-'+p.id,name:p.name,frames:[0,1,2,3].map((stage)=>({id:'demo-frame-'+p.id+'-'+stage,owner_id:roster[0].student_id,activity_id:'demo-activity-'+p.id,timeline_id:'demo-timeline-'+p.id,title:p.name+' · '+['Starting checkpoint','First connections','Stronger explanations','Connected ideas'][stage],is_checkpoint:stage===0,created_at:`2026-11-${String(2+stage*3).padStart(2,'0')}T16:00:00Z`,updated_at:`2026-11-${String(2+stage*3).padStart(2,'0')}T16:00:00Z`,data:dataFor(p,stage===0?3:p.labels.length,[1,3,5,7][stage])}))}));
  const studentMaps=projects.map(p=>timelines.find(t=>t.id==='demo-timeline-'+p.id)?.frames.at(-1)||maps.find(m=>m.owner_id===roster[0].student_id&&m.activity_id==='demo-activity-'+p.id));
  window.SpanDemo={projects,classes,roster,activities,maps,timelines,studentMaps,editor:studentMaps.find(m=>m.activity_id==='demo-activity-fractions'),getClass(id){const cls=classes.find(c=>c.id===id)||classes[0];return {...cls,roster:structuredClone(roster),maps:structuredClone(maps.filter(m=>activities.some(a=>a.id===m.activity_id&&a.class_id===cls.id))),taughtTopics:activities.filter(a=>a.class_id===cls.id).flatMap(a=>a.concepts)};}};
})();
