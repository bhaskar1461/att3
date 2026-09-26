import { useState, useRef, useCallback, useEffect } from 'react';

export interface GeoCoordinates {
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
}

export function useGeoVerification() {
  const studentGeoRef = useRef<GeoCoordinates | null>(null);
  const [currentCoords, setCurrentCoords] = useState<GeoCoordinates | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const getStudentGeolocation = useCallback((): Promise<GeoCoordinates> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !navigator.geolocation) {
        return resolve({});
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: GeoCoordinates = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy
          };
          studentGeoRef.current = coords;
          setCurrentCoords(coords);
          setGeoError(null);
          resolve(coords);
        },
        (err) => {
          console.warn('[Student GPS] Location acquisition warning:', err.message);
          setGeoError(err.message);
          resolve({});
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 }
      );
    });
  }, []);

  useEffect(() => {
    getStudentGeolocation();
  }, [getStudentGeolocation]);

  return {
    studentGeoRef,
    currentCoords,
    geoError,
    getStudentGeolocation
  };
}
