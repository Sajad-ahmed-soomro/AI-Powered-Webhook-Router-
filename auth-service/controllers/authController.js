import  pool  from "../config/db.js";
import bycrpt from 'bcrypt'
import jwt from 'jsonwebtoken';
import crypto from "crypto";



export const createUser=async(req,res)=>{
    try {
        
        
        const{fullname,email,password}=req.body;

        if(!fullname || !email || !password){
            return res.status(400).json("required credentials are missing");
        }
        const { rowCount: exists } = await pool.query(
            "SELECT 1 FROM users WHERE email = $1",
            [email]
          );
          if (exists) {
            return res.status(409).json({ error: "Email already registered" });
          }
        const strongPasswordRegex =
          /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

        if (!strongPasswordRegex.test(password)) {
          return res.status(400).json({ error: "Password too weak" });
        }

        const hashPassword=await bycrpt.hash(password,10)
        const query=`INSERT INTO users (fullname,email,password) VALUES ($1, $2, $3)`;
        const values=[fullname,email,hashPassword];

        const result=await pool.query(query,values);

        res.status(201).json({
            message:"user created successfully"
        })
    } catch (error) {
            res.status(500).json({error:"server error"});
    }


}

export const loginUser=async(req,res)=>{

    const {email,password}=req.body;

    console.log(email,password)
    if(!email || !password){
        return res.status(401).json({
            message:"Invalid email or password"
        })
    }
    try {

        const result=await pool.query(`SELECT *FROM users WHERE email=$1 `,[email]);
        console.log(result)
        
        if(result.rows.length===0){
           return  res.status(401).json({message:"Invalid email or password"});

        }
        const user=result.rows[0];

        const isMatch=await bycrpt.compare(password,user.password);
        if(!isMatch){

            return res.status(401).json({message:"Invalid email or password"});
        }
        const token=jwt.sign({id:user.id,email:user.email},process.env.SECRET,{
            expiresIn:'1h'
        })
        res.status(201).json({
            message:"login successful",
            token,
            user:{
                id:user.id,
                fullname:user.fullname,
                email:user.email
            }
        })
        
    } catch (error) {
        res.status(500).json({error:"server error"});
    }
}




export const createApiKey = async (req, res) => {
    try {
      const { name} = req.body;
      const userId = req.user.id;
      if (!name) {
        return res.status(400).json({ error: "API key name is required" });
      }
      
      // Generate API key
      const apiKey = crypto.randomBytes(32).toString('hex');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      console.log("before api key")
      const result = await pool.query(
        `INSERT INTO api_keys (user_id, name, key_hash) 
         VALUES ($1, $2, $3) RETURNING id, name, created_at`,
        [userId, name, keyHash]
      );
      console.log("after api key")
      res.status(201).json({
        ...result.rows[0],
        api_key: apiKey // Only return once
      });
      
    } catch (err) {
      console.error("Create API key error:", err)
      res.status(500).json({ error: 'Failed to create API key' });
    }
};
  
  export const getUserApiKeys = async (req, res) => {
    try {
      console.log("get user")
      const result = await pool.query(
        `SELECT id, name, permissions, is_active, created_at, last_used_at 
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [req.user.id]
      );
      console.log("api key get error")
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch API keys' });
    }
  };
  
  export const revokeApiKey = async (req, res) => {
    try {
      const { keyId } = req.params;
      const result = await pool.query(
        `UPDATE api_keys SET is_active = false 
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [keyId, req.user.id]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'API key not found' });
      }
      
      res.json({ message: 'API key revoked' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  };