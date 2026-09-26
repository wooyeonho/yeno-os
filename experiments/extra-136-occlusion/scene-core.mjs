const PORTAL={cx:480,cy:286,rx:170,ry:200,plane:50};

export function projectObject({position,depth}) {
  for(const value of [position,depth])
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)
      throw new RangeError('position and depth must be numbers in the 0–100 range');
  const x=PORTAL.cx+(position-50)*6;
  const y=300+(50-depth)*1.5;
  const radius=38-depth*0.16;
  const apertureAtY=PORTAL.rx*Math.sqrt(1-((y-PORTAL.cy)/PORTAL.ry)**2);
  const behind=depth>PORTAL.plane;
  const visibility=behind?(Math.abs(x-PORTAL.cx)>apertureAtY+radius?'hidden':'through'):'front';
  return Object.freeze({x,y,radius,position,depth,layer:behind?'behind':'front',visibility,visible:visibility!=='hidden',portalPlane:PORTAL.plane});
}
